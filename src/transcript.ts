import * as fs from 'fs';
import * as readline from 'readline';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem } from './types.js';

interface TranscriptLine {
  type?: string;  // 'user' or 'assistant'
  timestamp?: string;
  message?: {
    content?: ContentBlock[] | string;
  };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  text?: string;  // For text content blocks
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const userMessages: string[] = [];

  try {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptLine;
        processEntry(entry, toolMap, agentMap, latestTodos, result);

        // Extract user messages
        if (entry.type === 'user' && entry.message?.content) {
          const msgText = extractUserText(entry.message.content);
          if (msgText && !isUnhelpfulMessage(msgText)) {
            userMessages.push(msgText);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Return partial results on error
  }

  result.tools = Array.from(toolMap.values()).slice(-20);
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;

  // Get the last user message
  if (userMessages.length > 0) {
    result.lastUserMessage = userMessages[userMessages.length - 1];
  }

  return result;
}

function extractUserText(content: ContentBlock[] | string): string {
  if (typeof content === 'string') {
    return content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }
    return textParts.join(' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

function isUnhelpfulMessage(msg: string): boolean {
  return (
    msg.startsWith('[Request interrupted') ||
    msg.startsWith('[Request cancelled') ||
    msg === ''
  );
}

function processEntry(
  entry: TranscriptLine,
  toolMap: Map<string, ToolEntry>,
  agentMap: Map<string, AgentEntry>,
  latestTodos: TodoItem[],
  result: TranscriptData
): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

  if (!result.sessionStart && entry.timestamp) {
    result.sessionStart = timestamp;
  }

  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const toolEntry: ToolEntry = {
        id: block.id,
        name: block.name,
        target: extractTarget(block.name, block.input),
        status: 'running',
        startTime: timestamp,
      };

      if (block.name === 'Task') {
        const input = block.input as Record<string, unknown>;
        const agentEntry: AgentEntry = {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'unknown',
          model: (input?.model as string) ?? undefined,
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
        };
        agentMap.set(block.id, agentEntry);
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input?.todos && Array.isArray(input.todos)) {
          latestTodos.length = 0;
          latestTodos.push(...input.todos);
        }
      } else {
        toolMap.set(block.id, toolEntry);
      }
    }

    if (block.type === 'tool_result' && block.tool_use_id) {
      const tool = toolMap.get(block.tool_use_id);
      if (tool) {
        tool.status = block.is_error ? 'error' : 'completed';
        tool.endTime = timestamp;
      }

      const agent = agentMap.get(block.tool_use_id);
      if (agent) {
        agent.status = 'completed';
        agent.endTime = timestamp;
      }
    }
  }
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) ?? (input.path as string);
    case 'Glob':
      return input.pattern as string;
    case 'Grep':
      return input.pattern as string;
    case 'Bash':
      const cmd = input.command as string;
      return cmd?.slice(0, 30) + (cmd?.length > 30 ? '...' : '');
  }
  return undefined;
}
