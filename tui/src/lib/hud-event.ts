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

export const HUD_EVENT_SCHEMA_VERSION = 1;

export type HudEventParseErrorCode = 'event_parse_failed' | 'schema_version_mismatch';

export interface HudEventParseError {
  code: HudEventParseErrorCode;
  message: string;
  context?: Record<string, unknown>;
}

export type HudEventParseResult =
  | { ok: true; event: HudEvent; warning?: HudEventParseError }
  | { ok: false; error: HudEventParseError };

function buildParseError(
  code: HudEventParseErrorCode,
  message: string,
  context?: Record<string, unknown>,
): HudEventParseResult {
  return { ok: false, error: { code, message, context } };
}

function linePreview(line: string): string {
  if (line.length <= 200) return line;
  return `${line.slice(0, 200)}…`;
}

export function parseHudEventResult(line: string): HudEventParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return buildParseError('event_parse_failed', 'Invalid JSON payload', {
      linePreview: linePreview(line),
      lineLength: line.length,
    });
  }

  if (!isRecord(raw)) {
    return buildParseError('event_parse_failed', 'Event payload is not an object', {
      linePreview: linePreview(line),
      lineLength: line.length,
    });
  }

  const event = readString(raw.event);
  const session = readString(raw.session);
  const ts = readNumber(raw.ts);
  const tool = 'tool' in raw ? readStringOrNull(raw.tool) : null;
  const input = 'input' in raw ? readRecordOrNull(raw.input) : null;
  const response = 'response' in raw ? readRecordOrNull(raw.response) : null;
  const schemaVersion = readNumber(raw.schemaVersion);

  if (
    !schemaVersion ||
    !event ||
    !session ||
    ts === undefined ||
    tool === undefined ||
    input === undefined
  ) {
    return buildParseError('event_parse_failed', 'Missing required event fields', {
      event,
      session,
      schemaVersion,
    });
  }
  if (response === undefined) {
    return buildParseError('event_parse_failed', 'Malformed response field', {
      event,
      session,
      schemaVersion,
    });
  }
  const schemaWarning =
    schemaVersion > HUD_EVENT_SCHEMA_VERSION
      ? {
          code: 'schema_version_mismatch' as const,
          message: `Schema version ${schemaVersion} is newer than supported ${HUD_EVENT_SCHEMA_VERSION}`,
          context: { schemaVersion, expected: HUD_EVENT_SCHEMA_VERSION, event },
        }
      : undefined;

  if (schemaVersion < HUD_EVENT_SCHEMA_VERSION) {
    return buildParseError(
      'schema_version_mismatch',
      `Schema version ${schemaVersion} is older than supported ${HUD_EVENT_SCHEMA_VERSION}`,
      {
        schemaVersion,
        expected: HUD_EVENT_SCHEMA_VERSION,
        event,
      },
    );
  }

  const parsed: HudEvent = {
    event,
    schemaVersion,
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

  return { ok: true, event: parsed, warning: schemaWarning };
}

export function parseHudEvent(line: string): HudEvent | null {
  const result = parseHudEventResult(line);
  return result.ok ? result.event : null;
}
