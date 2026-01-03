import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderToolsLine } from '../dist/render/tools-line.js';
import { renderAgentsLine } from '../dist/render/agents-line.js';
import { renderTodosLine } from '../dist/render/todos-line.js';

function baseContext() {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 100,
        current_usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
  };
}

test('renderSessionLine adds token breakdown when context is high', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage.input_tokens = 90;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('in:'), 'expected token breakdown');
  assert.ok(line.includes('cache:'), 'expected cache breakdown');
});

test('renderSessionLine shows compact warning at critical threshold', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage.input_tokens = 96;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('COMPACT'));
});

test('renderToolsLine renders running and completed tools', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Read',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(0),
      duration: 0,
    },
    {
      id: 'tool-2',
      name: 'Edit',
      target: '/tmp/example.txt',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('Read'));
  assert.ok(line?.includes('Edit'));
});

test('renderAgentsLine renders completed agents', () => {
  const ctx = baseContext();
  ctx.transcript.agents = [
    {
      id: 'agent-1',
      type: 'explore',
      model: 'haiku',
      description: 'Finding auth code',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(0),
      elapsed: 0,
    },
  ];

  const line = renderAgentsLine(ctx);
  assert.ok(line?.includes('explore'));
  assert.ok(line?.includes('haiku'));
});

test('renderTodosLine handles in-progress and completed-only cases', () => {
  const ctx = baseContext();
  ctx.transcript.todos = [
    { content: 'First task', status: 'completed' },
    { content: 'Second task', status: 'in_progress' },
  ];
  assert.ok(renderTodosLine(ctx)?.includes('Second task'));

  ctx.transcript.todos = [{ content: 'First task', status: 'completed' }];
  assert.ok(renderTodosLine(ctx)?.includes('All todos complete'));
});
