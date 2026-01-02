export function truncatePath(path: string, maxLen: number): string {
  if (!path || path.length <= maxLen) return path;

  const parts = path.split('/');
  if (parts.length >= 2) {
    const filename = parts[parts.length - 1];
    const parent = parts[parts.length - 2];

    if (filename.length > maxLen - 4) {
      return `…${filename.slice(-(maxLen - 1))}`;
    }

    const combined = `${parent}/${filename}`;
    if (combined.length <= maxLen) {
      return combined;
    }

    const available = maxLen - filename.length - 2;
    return `…${parent.slice(-available)}/${filename}`;
  }

  return `…${path.slice(-(maxLen - 1))}`;
}

export function truncatePathTail(path: string, maxLen: number): string {
  if (!path || path.length <= maxLen) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-(maxLen - 3));
  return '.../' + parts.slice(-2).join('/');
}

export function truncateDescription(desc: string, maxLen: number = 25): string {
  if (!desc || desc.length <= maxLen) return desc;
  return `${desc.slice(0, maxLen - 1)}…`;
}

export function formatDurationMs(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}
