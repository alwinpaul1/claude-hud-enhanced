export interface HudEvent {
  event: string;
  tool: string | null;
  input: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  session: string;
  ts: number;
}

export interface ToolEntry {
  id: string;
  tool: string;
  target: string;
  status: 'running' | 'complete' | 'error';
  ts: number;
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
}

export interface ContextState {
  tokens: number;
  percent: number;
  remaining: number;
  maxTokens: number;
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
}

export interface ContextBreakdown {
  toolOutputs: number;
  toolInputs: number;
  messages: number;
  other: number;
}

export interface AppState {
  events: HudEvent[];
  tools: ToolEntry[];
  todos: TodoItem[];
  modifiedFiles: Map<string, ModifiedFile>;
  context: ContextState;
  mcpServers: string[];
}
