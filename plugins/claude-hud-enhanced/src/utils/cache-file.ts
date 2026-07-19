import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Shared scaffolding for the HUD's JSON cache files. Extracted (rather than a
 * fifth inline copy) so every cache gets the same guarantees: private dirs
 * (0700), atomic writes (tmp + wx + rename — readers can never observe a torn
 * file even with many concurrent statusline processes), debug-visible corrupt
 * reads, and bounded on-disk growth. usage-snapshot.ts keeps its own atomic
 * writer (it carries lock semantics); sibling caches can migrate here later.
 */

export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 100;
export const CACHE_SWEEP_SAMPLE_RATE = 0.01;

/** Create `dir` (recursive) restricted to owner rwx; best-effort chmod if it already existed. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort: some filesystems do not support POSIX modes.
  }
}

/**
 * Read + JSON.parse a cache file. Returns null on missing/corrupt/invalid
 * content. `isValid` is the caller's shape check; `onError` lets each caller
 * log through its own namespaced `debug()`.
 */
export function readJsonCache<T>(
  filePath: string,
  isValid: (parsed: unknown) => parsed is T,
  onError?: (err: unknown) => void,
): T | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return isValid(parsed) ? parsed : null;
  } catch (err) {
    onError?.(err);
    return null;
  }
}

/**
 * Atomically write JSON to `filePath` (private parent dir, tmp + `wx` +
 * rename + chmod 0600). Returns success; never throws.
 */
export function writeJsonCacheAtomic(
  filePath: string,
  value: unknown,
  onError?: (err: unknown) => void,
): boolean {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    ensurePrivateDir(dir);
    fs.writeFileSync(tmpPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch (err) {
    onError?.(err);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* best effort */
    }
    return false;
  }
}

/**
 * Bound a cache directory: delete .json/.tmp entries older than
 * CACHE_MAX_AGE_MS, then oldest-first down to CACHE_MAX_ENTRIES. Callers
 * invoke this on a sampled fraction of writes (CACHE_SWEEP_SAMPLE_RATE) so
 * the hot path almost never pays for it. Also reaps orphaned .tmp files left
 * by writers killed mid-atomic-write.
 */
export function sweepCacheDir(
  cacheDir: string,
  now: number,
  onError?: (err: unknown) => void,
): void {
  try {
    if (!fs.existsSync(cacheDir)) return;
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    const survivors: { fullPath: string; mtimeMs: number }[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.tmp')) continue;
      const fullPath = path.join(cacheDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > CACHE_MAX_AGE_MS || entry.name.endsWith('.tmp')) {
          // .tmp files older than an instant are orphans from killed writers;
          // any .tmp seen during a sweep is safe to reap (writers hold them
          // only for the microseconds between write and rename).
          if (entry.name.endsWith('.tmp') && now - stat.mtimeMs < 60_000) {
            continue; // grace period for a genuinely in-flight write
          }
          fs.unlinkSync(fullPath);
          continue;
        }
        survivors.push({ fullPath, mtimeMs: stat.mtimeMs });
      } catch (err) {
        onError?.(err);
      }
    }

    if (survivors.length > CACHE_MAX_ENTRIES) {
      survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toDelete = survivors.length - CACHE_MAX_ENTRIES;
      for (let i = 0; i < toDelete; i += 1) {
        try {
          fs.unlinkSync(survivors[i].fullPath);
        } catch (err) {
          onError?.(err);
        }
      }
    }
  } catch (err) {
    onError?.(err);
  }
}
