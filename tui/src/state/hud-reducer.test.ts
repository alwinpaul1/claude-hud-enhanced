import { describe, expect, it } from 'vitest';
import { createInitialHudState } from './hud-state.js';
import { reduceHudState } from './hud-reducer.js';
import type { HudEvent } from '../lib/types.js';

function createState() {
  return createInitialHudState({
    context: {
      tokens: 0,
      percent: 0,
      remaining: 0,
      maxTokens: 0,
      burnRate: 0,
      status: 'healthy',
      shouldCompact: false,
      breakdown: { toolOutputs: 0, toolInputs: 0, messages: 0, other: 0 },
      sessionStart: 0,
      lastUpdate: 0,
      tokenHistory: [],
    },
    cost: { inputCost: 0, outputCost: 0, totalCost: 0, inputTokens: 0, outputTokens: 0 },
  });
}

describe('reduceHudState', () => {
  it('tracks tool lifecycle from PreToolUse to PostToolUse', () => {
    const state = createState();
    const preEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 100,
    };

    const afterPre = reduceHudState(state, { type: 'event', event: preEvent, now: 1000 });
    expect(afterPre.tools).toHaveLength(1);
    expect(afterPre.tools[0]?.status).toBe('running');
    expect(afterPre.sessionInfo.isIdle).toBe(false);
    expect(afterPre.runningTools.has('tool-1')).toBe(true);

    const postEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: null,
      response: { duration_ms: 250 },
      session: 's1',
      ts: 100,
    };

    const afterPost = reduceHudState(afterPre, { type: 'event', event: postEvent, now: 1300 });
    expect(afterPost.tools[0]?.status).toBe('complete');
    expect(afterPost.runningTools.has('tool-1')).toBe(false);
    expect(afterPost.tools[0]?.duration).toBe(250);
  });

  it('applies todo updates and agent lifecycle', () => {
    const state = createState();
    const todoEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'TodoWrite',
      toolUseId: 'todo-1',
      input: { todos: [{ content: 'Ship HUD tests', status: 'in_progress' }] },
      response: null,
      session: 's1',
      ts: 200,
    };
    const afterTodo = reduceHudState(state, { type: 'event', event: todoEvent, now: 2000 });
    expect(afterTodo.todos).toHaveLength(1);

    const taskEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Task',
      toolUseId: 'agent-1',
      input: { subagent_type: 'Research', description: 'Check HUD output' },
      response: null,
      session: 's1',
      ts: 300,
    };
    const afterTask = reduceHudState(afterTodo, { type: 'event', event: taskEvent, now: 3000 });
    expect(afterTask.agents).toHaveLength(1);
    expect(afterTask.agents[0]?.status).toBe('running');

    const stopEvent: HudEvent = {
      schemaVersion: 1,
      event: 'SubagentStop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 400,
    };
    const afterStop = reduceHudState(afterTask, { type: 'event', event: stopEvent, now: 4000 });
    expect(afterStop.agents[0]?.status).toBe('complete');
  });
});
