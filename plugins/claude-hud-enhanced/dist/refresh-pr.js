import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FETCH_EVERY, PR_EVERY, parseChecks, parseLeftRight, parsePr, parsePull, parseRemote, parseTrack, repoOf, requestKey, splitHttp, } from './pr-status.js';
import * as path from 'node:path';
import { CACHE_SWEEP_SAMPLE_RATE, readJsonCache, sweepCacheDir, writeJsonCacheAtomic } from './utils/cache-file.js';
export const emptyState = () => ({ version: 1, prView: {}, gh: {}, fetchedAt: {}, remotes: {} });
const WATCHDOG_MS = 45_000;
async function ghApi(state, deps, apiPath, cwd) {
    const cached = state.gh[apiPath];
    const out = await deps.run(['gh', 'api', apiPath, '-i', ...(cached ? ['-H', `If-None-Match: ${cached.etag}`] : [])], { cwd, timeoutMs: 8000 });
    const res = splitHttp(out.stdout);
    if (cached && (res.status === 304 || /HTTP 304/.test(out.stderr)))
        return cached.body;
    if (res.status !== 200)
        return null;
    if (res.etag)
        state.gh[apiPath] = { etag: res.etag, body: res.body };
    return res.body;
}
async function originRepo(state, deps, cwd) {
    const known = state.remotes[cwd];
    if (known !== undefined)
        return known;
    const out = await deps.run(['git', 'remote', 'get-url', 'origin'], { cwd }).catch(() => null);
    const repo = out && out.exitCode === 0 ? parseRemote(out.stdout) : '';
    state.remotes[cwd] = repo;
    return repo;
}
async function livePr(state, deps, pr, cwd, repo) {
    try {
        const pullPath = `repos/${repo}/pulls/${pr.number}`;
        const pullBody = await ghApi(state, deps, pullPath, cwd);
        const pull = pullBody ? parsePull(pullBody) : null;
        if (!pull)
            return pr;
        const { sha, ...live } = pull;
        let checks = null;
        if ((live.state === 'OPEN' || live.state === 'DRAFT') && sha) {
            const runsPath = `repos/${repo}/commits/${sha}/check-runs?per_page=100`;
            const runs = await ghApi(state, deps, runsPath, cwd);
            checks = runs ? parseChecks(runs) : null;
            const kept = new Set([pullPath, runsPath]);
            for (const key of Object.keys(state.gh)) {
                if (key.startsWith(`repos/${repo}/commits/`) && !kept.has(key))
                    delete state.gh[key];
            }
        }
        return { ...pr, ...live, branch: live.branch ?? pr.branch, ...(checks ? { checks } : {}) };
    }
    catch {
        return pr;
    }
}
async function readPr(state, deps, where, cwd, target) {
    const now = deps.now();
    const hit = state.prView[where];
    if (hit && now - hit.at < PR_EVERY)
        return hit.pr;
    try {
        const out = await deps.run(['gh', 'pr', 'view', ...(target ? [target] : []), '--json', 'number,state,isDraft,headRefName,baseRefName'], { cwd, timeoutMs: 8000 });
        const pr = out.exitCode === 0 ? parsePr(out.stdout) : null;
        state.prView[where] = { at: now, pr };
        return pr;
    }
    catch {
        return state.prView[where]?.pr ?? null;
    }
}
async function compareBase(state, deps, cwd, base, branch) {
    const now = deps.now();
    const key = `${cwd}@${base}`;
    let fetch = null;
    if (now - (state.fetchedAt[key] ?? 0) > FETCH_EVERY) {
        state.fetchedAt[key] = now;
        fetch = () => deps
            .run(['git', 'fetch', '--quiet', '--no-tags', 'origin', base], {
            cwd,
            timeoutMs: 20_000,
            env: { GIT_TERMINAL_PROMPT: '0' },
        })
            .then(() => undefined)
            .catch(() => undefined);
    }
    const hasLocal = (await deps.run(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd })).exitCode === 0;
    const ref = hasLocal ? branch : `origin/${branch}`;
    const counts = await deps.run(['git', 'rev-list', '--left-right', '--count', `origin/${base}...${ref}`], { cwd });
    const lr = counts.exitCode === 0 ? parseLeftRight(counts.stdout) : null;
    return { compare: lr ? { name: base, ...lr } : undefined, fetch };
}
export async function refreshPr(req, state, deps) {
    const { cwd } = req;
    const snapshot = { version: 1, at: deps.now(), request: requestKey(req), pr: null };
    let shown = req.branch;
    let fetch = null;
    const titled = req.named === null ? null : await readPr(state, deps, `title:${req.named}`, cwd, `${req.named}`);
    const here = await originRepo(state, deps, cwd);
    const worked = req.sessionPr && (!here || !req.sessionPr.url || repoOf(req.sessionPr.url).toLowerCase() === here)
        ? req.sessionPr
        : null;
    const ownPr = titled ? { number: titled.number, url: '', owned: true } : worked;
    let livePrOfSession = null;
    if (ownPr) {
        const target = ownPr.url || `${ownPr.number}`;
        const found = titled ?? (await readPr(state, deps, `session:${target}`, cwd, target));
        if (found)
            livePrOfSession = await livePr(state, deps, found, cwd, repoOf(ownPr.url));
    }
    const done = livePrOfSession !== null && (livePrOfSession.state === 'MERGED' || livePrOfSession.state === 'CLOSED');
    if (livePrOfSession && !(done && livePrOfSession.branch !== req.branch)) {
        snapshot.pr = livePrOfSession;
        const own = livePrOfSession.branch;
        if (own && own !== req.branch) {
            const track = await deps
                .run(['git', 'for-each-ref', '--format=%(upstream:track)', `refs/heads/${own}`], { cwd })
                .catch(() => null);
            snapshot.own = { branch: own, ...parseTrack(track && track.exitCode === 0 ? track.stdout : '') };
            shown = own;
        }
    }
    else if (req.branch !== '?' && !/^[0-9a-f]{7}$/.test(req.branch) && !req.branch.startsWith('detached:')) {
        const found = await readPr(state, deps, `${cwd}@${req.branch}`, cwd);
        snapshot.pr = found ? await livePr(state, deps, found, cwd, repoOf(undefined)) : null;
    }
    if (snapshot.pr?.base) {
        const compared = await compareBase(state, deps, cwd, snapshot.pr.base, shown).catch(() => null);
        if (compared?.compare)
            snapshot.base = compared.compare;
        fetch = compared?.fetch ?? null;
    }
    return { snapshot, fetch };
}
const run = (argv, opts) => new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    execFile(cmd ?? '', args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 5000,
        env: { ...process.env, ...opts.env },
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
    }, (error, stdout, stderr) => {
        if (!error)
            return resolve({ exitCode: 0, stdout, stderr });
        const code = error.code;
        if (typeof code === 'number')
            return resolve({ exitCode: code, stdout, stderr });
        reject(error);
    });
});
function isState(v) {
    const s = v;
    return (s != null
        && s.version === 1
        && typeof s.prView === 'object' && s.prView !== null
        && typeof s.gh === 'object' && s.gh !== null
        && typeof s.fetchedAt === 'object' && s.fetchedAt !== null
        && typeof s.remotes === 'object' && s.remotes !== null);
}
function prune(state, now) {
    for (const [key, entry] of Object.entries(state.prView)) {
        if (now - entry.at > 6 * PR_EVERY)
            delete state.prView[key];
    }
}
async function main() {
    let paths = null;
    const watchdog = setTimeout(() => {
        if (paths)
            fs.rmSync(paths.lock, { force: true });
        process.exit(0);
    }, WATCHDOG_MS);
    try {
        const payload = JSON.parse(process.argv[2] ?? '');
        paths = payload.paths;
        const state = readJsonCache(paths.state, isState) ?? emptyState();
        const deps = { run, now: Date.now };
        const { snapshot, fetch } = await refreshPr(payload.request, state, deps);
        writeJsonCacheAtomic(paths.snapshot, snapshot);
        prune(state, deps.now());
        writeJsonCacheAtomic(paths.state, state);
        if (Math.random() < CACHE_SWEEP_SAMPLE_RATE)
            sweepCacheDir(path.dirname(paths.snapshot), deps.now());
        if (fetch)
            await fetch();
    }
    catch {
        process.exitCode = 0;
    }
    finally {
        clearTimeout(watchdog);
        if (paths)
            fs.rmSync(paths.lock, { force: true });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main();
}
//# sourceMappingURL=refresh-pr.js.map