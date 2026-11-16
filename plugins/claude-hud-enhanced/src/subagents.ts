import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GitStatus } from './git.js';
import type { AgentEntry } from './types.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

export interface SubagentSeen {
  id?: string;
  type: string;
  model: string;
  modelId: string;
  effort: string | null;
  tokens: number | null;
  window?: number;
  worktree?: string;
  git?: GitStatus | null;
}

interface SubagentMeta {
  id: string;
  agentType?: string;
  worktreePath?: string;
  model?: string;
}

export const MAX_PILL_AGENTS = 3;
const TAIL_BYTES = 256 * 1024;
const MAX_META_FILES = 512;
const MAX_FEED_FILES = 128;
const TEXT_MAX_LEN = 64;

const clean = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = sanitizeDisplayText(value).trim().slice(0, TEXT_MAX_LEN);
  return text.length > 0 ? text : undefined;
};

export const subagentsDir = (transcriptPath: string): string =>
  path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');

function readMetas(dir: string, wanted: Set<string>): Map<string, SubagentMeta> {
  const found = new Map<string, SubagentMeta>();
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith('agent-') && name.endsWith('.meta.json'));
  } catch {
    return found;
  }
  for (const name of names.slice(-MAX_META_FILES).reverse()) {
    if (found.size === wanted.size) break;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;
      const toolUseId = typeof meta.toolUseId === 'string' ? meta.toolUseId : '';
      if (!wanted.has(toolUseId)) continue;
      found.set(toolUseId, {
        id: name.slice('agent-'.length, -'.meta.json'.length),
        agentType: clean(meta.agentType),
        worktreePath: typeof meta.worktreePath === 'string' && meta.worktreePath.length > 0 ? meta.worktreePath : undefined,
        model: clean(meta.pickedEffortModel) ?? clean(meta.model),
      });
    } catch {
      continue;
    }
  }
  return found;
}

function readTail(filePath: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        fd = undefined;
      }
    }
  }
}

export interface AgentFeedEntry {
  modelId?: string;
  effort?: string;
  window?: number;
  tokens?: number;
}

export function parseAgentFeed(text: string): Record<string, AgentFeedEntry> {
  const out: Record<string, AgentFeedEntry> = {};
  const tasks = (JSON.parse(text) as { tasks?: unknown }).tasks;
  for (const task of Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : []) {
    if (!task || typeof task.id !== 'string' || !task.id) continue;
    const modelId = clean(task.model);
    const effort = clean(task.effort);
    out[task.id] = {
      ...(modelId ? { modelId } : {}),
      ...(effort ? { effort } : {}),
      ...(typeof task.contextWindowSize === 'number' ? { window: task.contextWindowSize } : {}),
      ...(typeof task.tokenCount === 'number' ? { tokens: task.tokenCount } : {}),
    };
  }
  return out;
}

export const knownWindows = new Map<string, number>();

export const learnWindows = (text: string): void => {
  for (const line of text.split('\n')) {
    try {
      const tasks = (JSON.parse(line) as { tasks?: unknown }).tasks;
      for (const task of Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : []) {
        const model = task ? clean(task.model) : undefined;
        const window = task?.contextWindowSize;
        if (model && typeof window === 'number' && Number.isFinite(window) && window > 0) knownWindows.set(model, window);
      }
    } catch {
      continue;
    }
  }
};

export function seedKnownWindows(feedDir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(feedDir).filter((name) => name.startsWith('sa-') && name.endsWith('.json'));
  } catch {
    return;
  }
  for (const name of names.slice(-MAX_FEED_FILES)) {
    const text = readTail(path.join(feedDir, name));
    if (text) learnWindows(text.replace(/\n/g, ''));
  }
}

function readAgentFeed(feedPath: string | undefined): Record<string, AgentFeedEntry> {
  if (!feedPath) return {};
  try {
    return parseAgentFeed(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    return {};
  }
}

export function parseAgentTail(tail: string): { modelId: string | null; effort: string | null; tokens: number | null } {
  const effort = [...tail.matchAll(/"effort":"([a-z]+)"/g)].at(-1)?.[1] ?? null;
  let modelId: string | null = null;
  let tokens: number | null = null;
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0 && (modelId === null || tokens === null); i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    try {
      const message = (JSON.parse(line) as { message?: { model?: unknown; usage?: Record<string, unknown> } }).message;
      const usage = message?.usage;
      if (!usage || typeof usage.input_tokens !== 'number') continue;
      const count = (key: string): number => (typeof usage[key] === 'number' ? (usage[key] as number) : 0);
      if (tokens === null) {
        tokens = count('input_tokens') + count('cache_read_input_tokens') + count('cache_creation_input_tokens');
      }
      if (modelId === null && typeof message?.model === 'string' && message.model.startsWith('claude-')) {
        modelId = clean(message.model) ?? null;
      }
    } catch {
      continue;
    }
  }
  return { modelId, effort, tokens };
}

export async function readRunningSubagents(
  transcriptPath: string | undefined,
  agents: AgentEntry[],
  getGit: (cwd: string) => Promise<GitStatus | null>,
  feedPath?: string,
): Promise<SubagentSeen[]> {
  const running = agents.filter((agent) => agent.status === 'running').slice(-MAX_PILL_AGENTS);
  if (running.length === 0) return [];
  const dir = transcriptPath ? subagentsDir(transcriptPath) : null;
  const metas = dir ? readMetas(dir, new Set(running.map((agent) => agent.id))) : new Map<string, SubagentMeta>();
  const feed = metas.size > 0 ? readAgentFeed(feedPath) : {};
  const seen: SubagentSeen[] = [];
  for (const agent of running) {
    const meta = metas.get(agent.id);
    const tail = meta && dir ? parseAgentTail(readTail(path.join(dir, `agent-${meta.id}.jsonl`))) : null;
    const fed = meta ? feed[meta.id] : undefined;
    const modelId = fed?.modelId ?? tail?.modelId ?? meta?.model ?? agent.model ?? '';
    const entry: SubagentSeen = {
      id: agent.id,
      type: meta?.agentType ?? clean(agent.type) ?? 'agent',
      model: modelId || '?',
      modelId,
      effort: fed?.effort ?? tail?.effort ?? null,
      tokens: fed?.tokens ?? tail?.tokens ?? null,
      ...(fed?.window !== undefined ? { window: fed.window } : {}),
    };
    if (meta?.worktreePath) {
      entry.worktree = meta.worktreePath;
      entry.git = await getGit(meta.worktreePath).catch(() => null);
    }
    seen.push(entry);
  }
  if (feedPath && seen.some((entry) => entry.window === undefined && entry.modelId && !knownWindows.has(entry.modelId))) {
    seedKnownWindows(path.dirname(feedPath));
  }
  return seen;
}
