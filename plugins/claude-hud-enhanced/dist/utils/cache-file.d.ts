/**
 * Shared scaffolding for the HUD's JSON cache files. Extracted (rather than a
 * fifth inline copy) so every cache gets the same guarantees: private dirs
 * (0700), atomic writes (tmp + wx + rename — readers can never observe a torn
 * file even with many concurrent statusline processes), debug-visible corrupt
 * reads, and bounded on-disk growth. usage-snapshot.ts keeps its own atomic
 * writer (it carries lock semantics); sibling caches can migrate here later.
 */
export declare const CACHE_MAX_AGE_MS: number;
export declare const CACHE_MAX_ENTRIES = 100;
export declare const CACHE_SWEEP_SAMPLE_RATE = 0.01;
/** Create `dir` (recursive) restricted to owner rwx; best-effort chmod if it already existed. */
export declare function ensurePrivateDir(dir: string): void;
/**
 * Read + JSON.parse a cache file. Returns null on missing/corrupt/invalid
 * content. `isValid` is the caller's shape check; `onError` lets each caller
 * log through its own namespaced `debug()`.
 */
export declare function readJsonCache<T>(filePath: string, isValid: (parsed: unknown) => parsed is T, onError?: (err: unknown) => void): T | null;
/**
 * Atomically write JSON to `filePath` (private parent dir, tmp + `wx` +
 * rename + chmod 0600). Returns success; never throws.
 */
export declare function writeJsonCacheAtomic(filePath: string, value: unknown, onError?: (err: unknown) => void): boolean;
/**
 * Bound a cache directory: delete .json/.tmp entries older than
 * CACHE_MAX_AGE_MS, then oldest-first down to CACHE_MAX_ENTRIES. Callers
 * invoke this on a sampled fraction of writes (CACHE_SWEEP_SAMPLE_RATE) so
 * the hot path almost never pays for it. Also reaps orphaned .tmp files left
 * by writers killed mid-atomic-write.
 */
export declare function sweepCacheDir(cacheDir: string, now: number, onError?: (err: unknown) => void): void;
//# sourceMappingURL=cache-file.d.ts.map