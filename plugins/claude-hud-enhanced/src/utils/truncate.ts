/**
 * Truncate a string to `maxLen` characters, appending an ellipsis when
 * the string exceeds the limit.
 *
 * @param text    - The string to truncate.
 * @param maxLen  - Maximum character length (including the suffix).
 * @param suffix  - The truncation indicator (default: `'...'`).
 */
export function truncateString(
  text: string | null | undefined,
  maxLen: number,
  suffix = '...',
): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  let end = Math.max(0, maxLen - suffix.length);
  // Don't cut mid-surrogate-pair: a lone high surrogate (0xD800-0xDBFF) at the
  // boundary renders as a stray "�". Drop the dangling half instead.
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return text.slice(0, end) + suffix;
}
