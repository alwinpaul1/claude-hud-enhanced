/**
 * Strip ANSI escape sequences (CSI, OSC, 7-bit C1/Fe), control characters,
 * and bidi overrides from an untrusted string.
 *
 * Use this whenever displaying user-supplied or external text in the
 * terminal to prevent escape injection and layout corruption.
 */
export declare function sanitizeDisplayText(input: string): string;
/**
 * Strip a leading UTF-8 BOM (U+FEFF) before JSON.parse. Windows editors
 * (legacy Notepad "UTF-8", PowerShell 5.1 `Set-Content -Encoding UTF8`)
 * prepend `EF BB BF`, which JSON.parse rejects — silently discarding a
 * hand-edited config/settings file. Applied at every read of a
 * user-editable JSON file.
 */
export declare function stripBom(text: string): string;
//# sourceMappingURL=sanitize.d.ts.map