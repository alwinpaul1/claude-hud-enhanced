import type { HudEvent } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRecordOrNull(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  return isRecord(value) ? value : undefined;
}

export function parseHudEvent(line: string): HudEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;

  const event = readString(raw.event);
  const session = readString(raw.session);
  const ts = readNumber(raw.ts);
  const tool = 'tool' in raw ? readStringOrNull(raw.tool) : null;
  const input = 'input' in raw ? readRecordOrNull(raw.input) : null;
  const response = 'response' in raw ? readRecordOrNull(raw.response) : null;

  if (!event || !session || ts === undefined || tool === undefined || input === undefined) {
    return null;
  }
  if (response === undefined) return null;

  const parsed: HudEvent = {
    event,
    tool,
    toolUseId: readString(raw.toolUseId),
    input,
    response,
    session,
    ts,
  };

  const permissionMode = readString(raw.permissionMode);
  const transcriptPath = readString(raw.transcriptPath);
  const cwd = readString(raw.cwd);
  const prompt = readString(raw.prompt);

  if (permissionMode) parsed.permissionMode = permissionMode;
  if (transcriptPath) parsed.transcriptPath = transcriptPath;
  if (cwd) parsed.cwd = cwd;
  if (prompt) parsed.prompt = prompt;

  return parsed;
}
