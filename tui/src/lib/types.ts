type BaseHudEvent<TEvent extends string> = {
  event: TEvent;
  schemaVersion?: number;
  tool: string | null;
  toolUseId?: string;
  input: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  session: string;
  ts: number;
  permissionMode?: string;
  transcriptPath?: string;
  cwd?: string;
  prompt?: string;
};

export type KnownHudEvent =
  | BaseHudEvent<'PreToolUse'>
  | BaseHudEvent<'PostToolUse'>
  | BaseHudEvent<'UserPromptSubmit'>
  | BaseHudEvent<'Stop'>
  | BaseHudEvent<'PreCompact'>
  | BaseHudEvent<'SubagentStop'>
  | BaseHudEvent<'SessionStart'>
  | BaseHudEvent<'SessionEnd'>;

export type HudEvent = KnownHudEvent | BaseHudEvent<string>;

export interface ToolEntry {
  id: string;
  tool: string;
  target: string;
  status: 'running' | 'complete' | 'error';
  ts: number;
  startTs: number;
  endTs?: number;
  duration?: number;
  agentId?: string;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ModifiedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface AgentEntry {
  id: string;
  type: string;
  description: string;
  status: 'running' | 'complete' | 'error';
  startTs: number;
  endTs?: number;
  tools: ToolEntry[];
}

export interface ContextHealth {
  tokens: number;
  percent: number;
  remaining: number;
  maxTokens: number;
  burnRate: number;
  status: 'healthy' | 'warning' | 'critical';
  shouldCompact: boolean;
  breakdown: ContextBreakdown;
  sessionStart: number;
  lastUpdate: number;
  tokenHistory: number[];
}

export interface ContextBreakdown {
  toolOutputs: number;
  toolInputs: number;
  messages: number;
  other: number;
}

export interface SessionInfo {
  sessionId: string;
  permissionMode: string;
  cwd: string;
  transcriptPath: string;
  isIdle: boolean;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}
