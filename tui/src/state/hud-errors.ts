export type HudErrorCode =
  | 'settings_read_failed'
  | 'config_read_failed'
  | 'schema_version_mismatch'
  | 'event_parse_failed';

export interface HudError {
  code: HudErrorCode;
  message: string;
  ts: number;
  context?: Record<string, unknown>;
}
