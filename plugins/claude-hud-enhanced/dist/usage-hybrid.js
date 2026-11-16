import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { parseScopedWindows } from './stdin.js';
import { CACHE_SWEEP_SAMPLE_RATE, readJsonCache, sweepCacheDir, writeJsonCacheAtomic } from './utils/cache-file.js';
import { defaultSnapshotFs, getLockPath, getSnapshotPath, readSnapshot, writeSnapshotAtomic, } from './usage-snapshot.js';
/**
 * ccstatusline-style hybrid usage resolution.
 *
 *   - While CHATTING: Claude Code hands fresh `rate_limits` on stdin. A window
 *     in which stdin is ahead of the snapshot is persisted to the snapshot (which
 *     also resets the idle TTL clock; the LIVE-read gate still polls).
 *   - While IDLE: Claude Code keeps re-sending the last-known FROZEN rate_limits on
 *     every render (stdin usage is essentially never null mid-session). Idle is
 *     therefore detected as "stdin stopped advancing", not "stdin disappeared":
 *     frozen stdin doesn't rewrite the snapshot, so `updated_at` ages, and once it
 *     is past the TTL (and not in backoff) we spawn the detached OAuth refresher
 *     (refresh-usage.js) to pull the live account-wide number (e.g. usage burned on
 *     another device). Rendering never blocks on the network.
 *
 * Newer-detection, per window: resets more than SAME_WINDOW_MS apart are
 * different windows and the later one wins. Inside one window stdin only ever
 * moves the figure forward: a higher stdin reading wins unless it was observed
 * before the snapshot's (each session records when its own reading last changed,
 * see observeStdinUsage), a lower one never does, since a session's stdin lags
 * the account. Only an API reading may lower a figure (refresh-usage.ts). So a
 * stale stdin from an idle session can never clobber a fresher reading.
 */
/** Idle gate: how long the snapshot may sit unwritten before we refresh it. */
export const USAGE_TTL_MS = 60_000;
/**
 * Active gate: how stale the last LIVE read may get while the user is chatting.
 * stdin re-stamps `updated_at` on every message, so the idle gate alone can never
 * fire mid-conversation — and usage burned in another terminal, on another
 * machine, or on claude.ai would stay invisible until the session went quiet.
 */
export const OAUTH_MAX_AGE_MS = 60_000;
export const LOCK_STALE_MS = 60_000; // a refresher lock older than this is abandoned
// Refresher backoff policy lives HERE, next to the gates it must never undercut:
// if a backoff dropped below a spawn gate, a failing refresher would be
// respawned on nearly every stale render — the retry-storm shape this feature
// exists to prevent (ccstatusline #204). tests/usage-hybrid.test.js asserts the
// floor so a future gate cut cannot quietly erase it.
/**
 * A rejected token (401) waits five minutes: the cure is Claude Code refreshing
 * it or the user signing in again. A profile with no login at all makes no
 * request, so it is rechecked sooner (BACKOFF_NO_LOGIN_MS, a local Keychain
 * lookup) and a fresh /login shows within five minutes.
 */
export const BACKOFF_AUTH_MS = 5 * 60_000;
export const BACKOFF_ERROR_MS = 60_000;
/**
 * 429 fallback when the server sent no Retry-After, and the wait after any other
 * failed request: one minute, doubling per consecutive failure up to the cap, plus
 * up to BACKOFF_JITTER on top. A Retry-After the server did send is used as is.
 */
export const BACKOFF_RATE_LIMIT_MS = 60_000;
export const BACKOFF_RATE_LIMIT_MAX_MS = 15 * 60_000;
export const BACKOFF_ERROR_MAX_MS = 15 * 60_000;
export const BACKOFF_AUTH_MAX_MS = 5 * 60_000;
export const BACKOFF_NO_LOGIN_MS = 2 * 60_000;
export const BACKOFF_FORBIDDEN_MS = 60 * 60_000;
export const BACKOFF_FORBIDDEN_MAX_MS = 60 * 60_000;
export const BACKOFF_JITTER = 0.25;
export const SAME_WINDOW_MS = 60_000;
const LIMIT_AT = 100;
/**
 * How long a snapshot may go unconfirmed, while its OAuth poll is failing, before
 * the HUD flags the numbers as stale. Without this a poll that broke (an expired
 * token, a network outage) kept rendering the last good reading as if it were
 * live: one profile showed "Weekly 92%" for 33 hours while Claude Code was
 * refusing requests because the weekly limit had been hit.
 */
export const USAGE_STALE_MS = 15 * 60_000;
function toMs(d) {
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function parseMs(s) {
    if (!s)
        return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
}
/** ISO string for a valid Date, null otherwise (an Invalid Date would throw). */
function isoOrNull(d) {
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
/**
 * Compare one window (A vs B). Returns >0 if A is newer, <0 if B is newer, 0 if
 * equal or undecidable. Later reset = newer window; within the same window A is
 * newer only when it is higher and was not observed before B; otherwise B stands.
 */
function windowCompare(aReset, aPct, bReset, bPct, aSeen = null, bSeen = null) {
    if (aReset == null || bReset == null)
        return 0;
    if (Math.abs(aReset - bReset) >= SAME_WINDOW_MS)
        return aReset - bReset;
    if (aPct == null || bPct == null || aPct === bPct)
        return 0;
    if (aPct >= LIMIT_AT && bPct === 0)
        return 1;
    if (aPct < bPct)
        return -1;
    return aSeen != null && bSeen != null && aSeen < bSeen ? -1 : 1;
}
const seenFor = (seen) => typeof seen === 'number' ? { fiveHour: seen, sevenDay: seen } : (seen ?? { fiveHour: null, sevenDay: null });
export function compareStdinSnapshot(stdin, snap, stdinSeenAt = null) {
    const written = parseMs(snap.updated_at);
    const stdinSeen = seenFor(stdinSeenAt);
    const seenOf = (window) => parseMs(window.seen_at) ?? written;
    const five = windowCompare(toMs(stdin.fiveHourResetAt), stdin.fiveHour, parseMs(snap.five_hour.resets_at), snap.five_hour.used_percentage, stdinSeen.fiveHour, seenOf(snap.five_hour));
    if (five !== 0)
        return Math.sign(five);
    const seven = windowCompare(toMs(stdin.sevenDayResetAt), stdin.sevenDay, parseMs(snap.seven_day.resets_at), snap.seven_day.used_percentage, stdinSeen.sevenDay, seenOf(snap.seven_day));
    return Math.sign(seven);
}
const isWindowSeen = (v) => {
    const seen = v;
    return seen != null && typeof seen === 'object' && typeof seen.key === 'string' && typeof seen.at === 'number';
};
const isStdinSeen = (v) => {
    const seen = v;
    return seen != null && typeof seen === 'object' && isWindowSeen(seen.five) && isWindowSeen(seen.seven);
};
const windowKey = (percent, resetAt) => {
    const reset = toMs(resetAt);
    return percent == null && reset == null ? '' : `${percent}@${reset === null ? '' : Math.round(reset / SAME_WINDOW_MS)}`;
};
function observeWindow(known, key, now) {
    if (key === '')
        return { key, at: 0 };
    if (known === undefined)
        return { key, at: 0 };
    if (known.key === key)
        return known.at <= now ? known : { key, at: 0 };
    return { key, at: now };
}
export function observeStdinUsage(session, usage, now, homeDir = os.homedir()) {
    if (!session || usage == null)
        return null;
    try {
        const dir = path.join(getHudPluginDir(homeDir), 'usage-seen');
        const file = path.join(dir, `${createHash('sha256').update(session).digest('hex').slice(0, 16)}.json`);
        const known = readJsonCache(file, isStdinSeen);
        const five = observeWindow(known?.five, windowKey(usage.fiveHour, usage.fiveHourResetAt), now);
        const seven = observeWindow(known?.seven, windowKey(usage.sevenDay, usage.sevenDayResetAt), now);
        if (known === null || known.five !== five || known.seven !== seven) {
            writeJsonCacheAtomic(file, { five, seven });
            if (Math.random() < CACHE_SWEEP_SAMPLE_RATE)
                sweepCacheDir(dir, now);
        }
        return { fiveHour: five.at > 0 ? five.at : null, sevenDay: seven.at > 0 ? seven.at : null };
    }
    catch {
        return null;
    }
}
/** True when stdin is strictly newer than the snapshot (write-back decision). */
export function isStrictlyNewer(stdin, snap) {
    return compareStdinSnapshot(stdin, snap) > 0;
}
/** The snapshot's model-scoped windows (e.g. Fable), or null when it has none. */
function snapshotScopedWindows(snap) {
    const windows = parseScopedWindows(snap.model_scoped);
    return windows.length > 0 ? windows : null;
}
/** Snapshot → UsageData: the 5h/7d windows plus any model-scoped ones. */
export function snapshotToUsage(snap) {
    const fiveReset = parseMs(snap.five_hour.resets_at);
    const sevenReset = parseMs(snap.seven_day.resets_at);
    const scoped = snapshotScopedWindows(snap);
    return {
        fiveHour: snap.five_hour.used_percentage,
        sevenDay: snap.seven_day.used_percentage,
        fiveHourResetAt: fiveReset != null ? new Date(fiveReset) : null,
        sevenDayResetAt: sevenReset != null ? new Date(sevenReset) : null,
        ...(scoped != null && { scopedWindows: scoped }),
        ...(snap.extra_usage !== undefined && { extraUsage: snap.extra_usage }),
    };
}
/**
 * Serve the snapshot's windows while keeping the stdin extras the snapshot lacks
 * (model-scoped windows it has none of, the balance label), so a newer snapshot
 * never makes the Fable weekly bar or balance segment vanish.
 */
export function snapshotOverStdin(snap, stdinUsage) {
    const usage = snapshotToUsage(snap);
    return {
        ...usage,
        ...(usage.scopedWindows == null && stdinUsage.scopedWindows != null && { scopedWindows: stdinUsage.scopedWindows }),
        ...(stdinUsage.balanceLabel != null && { balanceLabel: stdinUsage.balanceLabel }),
    };
}
/**
 * Fill in the snapshot's model-scoped windows when `usage` carries none of its
 * own. Claude Code has not been forwarding `rate_limits.model_scoped` on stdin
 * (see index.ts), so without this the Fable window the OAuth poll found would
 * disappear the moment a live stdin reading won the comparison.
 */
function withSnapshotScoped(usage, snap) {
    const scoped = usage.scopedWindows != null ? null : snapshotScopedWindows(snap);
    const extra = usage.extraUsage !== undefined ? undefined : snap.extra_usage;
    if (scoped == null && extra === undefined)
        return usage;
    return {
        ...usage,
        ...(scoped != null && { scopedWindows: scoped }),
        ...(extra !== undefined && { extraUsage: extra }),
    };
}
function stdinWindow(percent, resetAt, prev, known, now) {
    if (percent == null && resetAt == null && known !== undefined) {
        const isAbsent = known.used_percentage == null && known.resets_at == null;
        return isAbsent || known.seen_at != null || prev == null ? known : { ...known, seen_at: prev.updated_at };
    }
    return { used_percentage: percent, resets_at: isoOrNull(resetAt), seen_at: new Date(now).toISOString() };
}
/**
 * UsageData → snapshot. `source` marks who wrote it. Refresher-owned fields
 * (`oauth_updated_at`, `status`, `next_attempt_at`) are carried verbatim from the
 * previous snapshot so a stdin write never clears an in-flight backoff the poller
 * set, nor forges a LIVE read that never happened.
 */
export function usageToSnapshot(usage, source, now, prev) {
    // stdin's own scoped windows when it has them; otherwise keep the poll's, so a
    // stdin write never erases the Fable window only the OAuth poll can see.
    const modelScoped = usage.scopedWindows != null
        ? usage.scopedWindows.map((w) => ({
            display_name: w.label,
            utilization: w.percent,
            resets_at: isoOrNull(w.resetAt),
        }))
        : prev?.model_scoped;
    return {
        updated_at: new Date(now).toISOString(),
        // Carried, never stamped: only a real OAuth read may move this clock. Resetting
        // it here would make every active render look never-polled and spawn again.
        oauth_updated_at: prev?.oauth_updated_at ?? null,
        source,
        five_hour: stdinWindow(usage.fiveHour, usage.fiveHourResetAt, prev, prev?.five_hour, now),
        seven_day: stdinWindow(usage.sevenDay, usage.sevenDayResetAt, prev, prev?.seven_day, now),
        ...(modelScoped !== undefined && { model_scoped: modelScoped }),
        ...(prev?.extra_usage !== undefined && { extra_usage: prev.extra_usage }),
        ...(prev?.failure_count !== undefined && { failure_count: prev.failure_count }),
        status: prev?.status ?? 'ok',
        next_attempt_at: prev?.next_attempt_at ?? null,
    };
}
/**
 * When the snapshot's numbers can no longer be presented as current, the time they
 * were last confirmed (by a stdin advance or a successful OAuth read); null while
 * they are fresh. Only a FAILING poll makes a snapshot stale: with a working one
 * the refresher replaces an aged snapshot within seconds, and flagging it in that
 * gap would flicker a warning after every laptop wake.
 */
export function snapshotStaleSince(snap, now) {
    if (snap.status === 'ok')
        return null;
    const confirmedAt = parseMs(snap.updated_at) ?? 0;
    return now - confirmedAt > USAGE_STALE_MS ? new Date(confirmedAt) : null;
}
/**
 * The single decision point for "should a refresher run now?", shared by the parent
 * (resolveUsage, which spawns) and the child (refresh-usage, which re-checks before
 * spending a request). Keeping it in ONE place is load-bearing: if the parent
 * spawned on a condition the child did not honour, the child would no-op, release
 * the lock, and be respawned on the very next render — a spawn storm wearing the
 * costume of a working single-flight.
 *
 * Unparseable timestamps read as infinitely stale, never as fresh: a corrupt clock
 * should cost one refresh, not freeze the display at a stale number forever.
 */
export function shouldRefresh(snap, now) {
    // Backoff outranks both gates — it is the storm guard itself.
    const nextAttempt = parseMs(snap.next_attempt_at);
    if (nextAttempt != null && nextAttempt > now)
        return false;
    const liveAt = parseMs(snap.oauth_updated_at);
    for (const window of [snap.five_hour, snap.seven_day]) {
        const reset = parseMs(window.resets_at);
        if (reset != null && reset <= now && (liveAt == null || liveAt < reset))
            return true;
    }
    const age = now - (parseMs(snap.updated_at) ?? 0);
    if (age > USAGE_TTL_MS)
        return true; // idle: nobody has written in a while
    const oauthAt = parseMs(snap.oauth_updated_at);
    return oauthAt == null || now - oauthAt > OAUTH_MAX_AGE_MS; // active: stale LIVE read
}
export function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === 'EPERM';
    }
}
function holderIsDead(lockPath, deps, options) {
    if (!options.reclaimDead)
        return false;
    try {
        const text = String(deps.readFileSync(lockPath, 'utf8')).trim();
        if (!/^\d+$/.test(text))
            return false;
        const pid = Number(text);
        return pid > 1 && pid !== process.pid && !(options.isAlive ?? isProcessAlive)(pid);
    }
    catch {
        return false;
    }
}
/**
 * Try to claim the single-flight refresher lock. Cleans up a stale lock (older than
 * LOCK_STALE_MS, or with `reclaimDead` one whose recorded holder pid is gone) left
 * by a crashed refresher, then creates the lock with `wx` so only
 * one caller wins the race. Returns true iff this caller now holds the lock.
 */
export function tryTakeLock(lockPath, now, deps, options = {}) {
    try {
        if (deps.existsSync(lockPath)) {
            try {
                const st = deps.statSync(lockPath);
                if (now - st.mtimeMs < LOCK_STALE_MS && !holderIsDead(lockPath, deps, options))
                    return false; // a fresh lock is held
            }
            catch {
                /* stat failed — fall through and try to re-take */
            }
            // Atomic stale reclaim via rename: of N racers, exactly ONE rename can
            // succeed (the rest get ENOENT), so a racer can never delete a lock
            // another racer just created. The previous rm-based reclaim had a TOCTOU
            // where every post-sleep terminal could "win" and spawn its own OAuth
            // refresher — an N-way burst violating the single-flight guarantee.
            const stalePath = `${lockPath}.stale.${process.pid}.${now}`;
            try {
                deps.renameSync(lockPath, stalePath);
            }
            catch {
                return false; // another racer reclaimed it first
            }
            try {
                deps.rmSync(stalePath, { force: true });
            }
            catch {
                /* best effort */
            }
        }
        deps.writeFileSync(lockPath, String(process.pid), {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve the usage to render, blending live stdin with the persisted snapshot.
 * Never blocks: any OAuth refresh happens in a detached child, and this call only
 * ever reads/writes local files.
 */
export function resolveUsage(stdinUsage, enabled, deps) {
    if (!enabled)
        return stdinUsage;
    const snapshotPath = getSnapshotPath(deps.homeDir);
    const lockPath = getLockPath(deps.homeDir);
    const snap = readSnapshot(snapshotPath, deps.fs);
    const now = deps.now();
    // Spawn the detached refresher iff shouldRefresh() says so, or when there is no
    // snapshot at all to judge. Throttled by the single-flight lock; never blocks or throws.
    const maybeRefresh = (s) => {
        if (deps.canRefresh?.() === false)
            return; // refresher not installed — no lock churn
        if ((s == null || shouldRefresh(s, now))
            && tryTakeLock(lockPath, now, deps.fs, { reclaimDead: true, isAlive: deps.isAlive })) {
            try {
                deps.spawnRefresher(deps.homeDir);
            }
            catch {
                /* never let a spawn failure break the render */
            }
        }
    };
    if (stdinUsage != null) {
        const seenAt = seenFor(deps.stdinSeenAt);
        const five = pickWindow(stdinUsage.fiveHour, stdinUsage.fiveHourResetAt, snap?.five_hour, snap, seenAt.fiveHour);
        const seven = pickWindow(stdinUsage.sevenDay, stdinUsage.sevenDayResetAt, snap?.seven_day, snap, seenAt.sevenDay);
        const known = snap ? snapshotToUsage(snap) : null;
        const merged = {
            ...stdinUsage,
            ...(five === 'snapshot' && known && { fiveHour: known.fiveHour, fiveHourResetAt: known.fiveHourResetAt }),
            ...(seven === 'snapshot' && known && { sevenDay: known.sevenDay, sevenDayResetAt: known.sevenDayResetAt }),
        };
        if (snap == null || five === 'newer' || seven === 'newer') {
            const written = usageToSnapshot({
                ...stdinUsage,
                ...(five !== 'newer' && snap && { fiveHour: null, fiveHourResetAt: null }),
                ...(seven !== 'newer' && snap && { sevenDay: null, sevenDayResetAt: null }),
            }, 'stdin', now, snap);
            writeSnapshotAtomic(snapshotPath, written, now, deps.fs);
            maybeRefresh(written);
            return withObservations(withSnapshotScoped(merged, written), written, { five, seven }, seenAt);
        }
        maybeRefresh(snap);
        return withObservations(withStaleness(withSnapshotScoped(merged, snap), snap, now), snap, { five, seven }, seenAt);
    }
    maybeRefresh(snap);
    if (snap == null)
        return null;
    return withObservations(withStaleness(snapshotToUsage(snap), snap, now), snap, { five: 'snapshot', seven: 'snapshot' }, seenFor(null));
}
function observedAt(window, snap, choice, stdinSeen, shown) {
    const stamped = parseMs(window.seen_at) ?? (choice === 'snapshot' ? parseMs(snap.updated_at) : null);
    const isSameFigure = window.used_percentage != null && window.used_percentage === shown;
    const at = choice === 'snapshot' ? stamped : isSameFigure ? Math.max(stamped ?? 0, stdinSeen ?? 0) || null : stdinSeen;
    return at === null ? null : new Date(at);
}
const isUnlimited = (window, shown, resetAt) => shown == null && resetAt == null && window.used_percentage == null && window.resets_at == null && parseMs(window.seen_at) != null;
function withObservations(usage, snap, choice, stdinSeen) {
    return {
        ...usage,
        fiveHourSeenAt: observedAt(snap.five_hour, snap, choice.five, stdinSeen.fiveHour, usage.fiveHour),
        sevenDaySeenAt: observedAt(snap.seven_day, snap, choice.seven, stdinSeen.sevenDay, usage.sevenDay),
        ...(isUnlimited(snap.five_hour, usage.fiveHour, usage.fiveHourResetAt) && { fiveHourUnlimited: true }),
        ...(isUnlimited(snap.seven_day, usage.sevenDay, usage.sevenDayResetAt) && { sevenDayUnlimited: true }),
    };
}
function pickWindow(percent, resetAt, known, snap, stdinSeenAt) {
    const reset = toMs(resetAt);
    if (percent == null && reset == null)
        return 'snapshot';
    if (known === undefined || snap == null)
        return 'newer';
    const knownReset = parseMs(known.resets_at);
    if (known.used_percentage == null && knownReset == null) {
        const absentAt = parseMs(known.seen_at);
        if (absentAt == null)
            return 'newer';
        return reset != null && reset <= absentAt ? 'snapshot' : 'stdin';
    }
    const order = windowCompare(reset, percent, knownReset, known.used_percentage, stdinSeenAt, parseMs(known.seen_at) ?? parseMs(snap.updated_at));
    if (order > 0)
        return 'newer';
    if (order < 0)
        return 'snapshot';
    return reset != null && knownReset != null ? 'stdin' : knownReset == null ? 'stdin' : 'snapshot';
}
/** Tag `usage` with the snapshot's staleness; returns it unchanged while fresh. */
function withStaleness(usage, snap, now) {
    const staleSince = snapshotStaleSince(snap, now);
    return staleSince ? { ...usage, staleSince } : usage;
}
export { defaultSnapshotFs };
//# sourceMappingURL=usage-hybrid.js.map