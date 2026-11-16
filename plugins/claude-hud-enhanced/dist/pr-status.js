import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { readJsonCache } from './utils/cache-file.js';
import { tryTakeLock } from './usage-hybrid.js';
import { defaultSnapshotFs } from './usage-snapshot.js';
export const PR_LIVE_EVERY = 5_000;
export const PR_IDLE_EVERY = 60_000;
export const PR_EVERY = 5 * 60_000;
export const FETCH_EVERY = 5 * 60_000;
export const parseTrack = (out) => ({
    ahead: Number(/ahead (\d+)/.exec(out)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(out)?.[1] ?? 0),
});
export const prFromTitle = (t) => {
    const m = /(?:^|[^\d])(\d{3,6})(?!\d)/.exec(t ?? '');
    return m ? Number(m[1]) : null;
};
export const parsePr = (json) => {
    try {
        const j = JSON.parse(json);
        if (typeof j.number !== 'number')
            return null;
        const state = j.isDraft === true && j.state === 'OPEN' ? 'DRAFT' : j.state;
        const branch = typeof j.headRefName === 'string' && j.headRefName !== '' ? { branch: j.headRefName } : {};
        return state === 'OPEN' || state === 'DRAFT' || state === 'MERGED' || state === 'CLOSED'
            ? { number: j.number, state, ...branch, ...(typeof j.baseRefName === 'string' ? { base: j.baseRefName } : {}) }
            : null;
    }
    catch {
        return null;
    }
};
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g;
const GH_PR = /\bgh\s+pr\s+(create|view|merge|ready|edit|checkout|reopen|close|comment)\b/;
const OWNS = new Set(['create', 'merge', 'ready', 'edit', 'reopen', 'close']);
export const isGhPrCommand = (command) => GH_PR.test(command);
export const prFromCommand = (command, output) => {
    const verb = GH_PR.exec(command)?.[1];
    if (!verb)
        return null;
    const urls = [...output.matchAll(PR_URL), ...command.matchAll(PR_URL)];
    const last = urls.at(-1);
    return last ? { number: Number(last[1]), url: last[0], owned: OWNS.has(verb) } : null;
};
export const prFromResult = (result) => {
    const op = result
        ?.gitOperation?.pr;
    if (!op || typeof op.number !== 'number')
        return null;
    return { number: op.number, url: typeof op.url === 'string' ? op.url : '', owned: op.action !== 'commented' };
};
export const pickPr = (prev, seen) => !seen ? prev : !prev || seen.owned || !prev.owned ? seen : prev;
export const splitHttp = (out) => {
    const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(out)?.[1] ?? 0);
    const gap = /\r?\n\r?\n/.exec(out);
    const headers = gap ? out.slice(0, gap.index) : out;
    const body = gap ? out.slice(gap.index + gap[0].length) : '';
    return { status, etag: /^etag:\s*(.+?)\s*$/im.exec(headers)?.[1] ?? null, body };
};
const READINESS = {
    clean: 'clean',
    has_hooks: 'clean',
    dirty: 'conflicts',
    blocked: 'blocked',
    unstable: 'failing',
    behind: 'behind',
};
export const parsePull = (body) => {
    try {
        const j = JSON.parse(body);
        if (typeof j.number !== 'number')
            return null;
        const state = j.merged === true ? 'MERGED' : j.state === 'closed' ? 'CLOSED' : j.draft === true ? 'DRAFT' : 'OPEN';
        return {
            number: j.number,
            state,
            ...(typeof j.head?.ref === 'string' ? { branch: j.head.ref } : {}),
            ...(typeof j.base?.ref === 'string' ? { base: j.base.ref } : {}),
            ready: READINESS[String(j.mergeable_state)] ?? 'unknown',
            sha: typeof j.head?.sha === 'string' ? j.head.sha : '',
        };
    }
    catch {
        return null;
    }
};
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);
export const parseChecks = (body) => {
    try {
        const runs = JSON.parse(body).check_runs;
        if (!Array.isArray(runs))
            return null;
        const checks = { failing: 0, pending: 0, passing: 0 };
        for (const run of runs) {
            if (run.status !== 'completed')
                checks.pending += 1;
            else if (FAILED.has(String(run.conclusion)))
                checks.failing += 1;
            else
                checks.passing += 1;
        }
        return checks;
    }
    catch {
        return null;
    }
};
export const parseRemote = (url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]?.toLowerCase() ?? '';
export const repoOf = (url) => /github\.com\/([^/\s]+\/[^/\s]+)\/pull\//.exec(url ?? '')?.[1] ?? '{owner}/{repo}';
export const parseLeftRight = (out) => {
    const m = /^(\d+)\s+(\d+)/.exec(out.trim());
    return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
};
export const requestKey = (req) => JSON.stringify([req.branch, req.named, req.sessionPr?.number ?? null, req.sessionPr?.url ?? '']);
export function prPaths(req, homeDir = os.homedir()) {
    const key = createHash('sha256').update(`${req.cwd}\n${req.session}`).digest('hex').slice(0, 16);
    const dir = path.join(getHudPluginDir(homeDir), 'pr-cache');
    return {
        snapshot: path.join(dir, `pr-${key}.json`),
        state: path.join(dir, `pr-${key}.state.json`),
        lock: path.join(dir, `.pr-${key}.lock`),
    };
}
const PR_STATES = new Set(['OPEN', 'DRAFT', 'MERGED', 'CLOSED']);
const READY_STATES = new Set(['clean', 'conflicts', 'blocked', 'failing', 'behind', 'unknown']);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
function isPr(v) {
    const pr = v;
    return (pr != null
        && typeof pr === 'object'
        && isCount(pr.number)
        && typeof pr.state === 'string'
        && PR_STATES.has(pr.state)
        && (pr.branch === undefined || typeof pr.branch === 'string')
        && (pr.base === undefined || typeof pr.base === 'string')
        && (pr.ready === undefined || (typeof pr.ready === 'string' && READY_STATES.has(pr.ready)))
        && (pr.checks === undefined
            || (pr.checks != null && isCount(pr.checks.failing) && isCount(pr.checks.pending) && isCount(pr.checks.passing))));
}
export function isPrSnapshot(v) {
    const s = v;
    return (s != null
        && typeof s === 'object'
        && s.version === 1
        && typeof s.at === 'number'
        && typeof s.request === 'string'
        && (s.pr === null || isPr(s.pr))
        && (s.own === undefined
            || (s.own != null && typeof s.own.branch === 'string' && isCount(s.own.ahead) && isCount(s.own.behind)))
        && (s.base === undefined
            || (s.base != null && typeof s.base.name === 'string' && isCount(s.base.ahead) && isCount(s.base.behind))));
}
export function resolvePrStatus(req, deps) {
    const paths = prPaths(req, deps.homeDir ?? os.homedir());
    const now = deps.now();
    const key = requestKey(req);
    const snapshot = readJsonCache(paths.snapshot, isPrSnapshot);
    const current = snapshot !== null && snapshot.request === key ? snapshot : null;
    const freshFor = current?.pr ? PR_LIVE_EVERY : PR_IDLE_EVERY;
    if (current === null || now - current.at >= freshFor || now < current.at) {
        try {
            deps.ensureDir(path.dirname(paths.lock));
            if (tryTakeLock(paths.lock, now, deps.fs ?? defaultSnapshotFs))
                deps.spawnRefresher(req, paths);
        }
        catch {
            return current;
        }
    }
    return current;
}
//# sourceMappingURL=pr-status.js.map