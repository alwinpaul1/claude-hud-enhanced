import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../lib/types.js';

interface Props {
  todos: TodoItem[];
}

const STATUS_ICONS: Record<string, string> = {
  pending: '[ ]',
  in_progress: '[●]',
  completed: '[✓]',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
};

export function TodoList({ todos }: Props) {
  const visibleTodos = todos.slice(0, 6);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        Todo
      </Text>
      {visibleTodos.length === 0 ? (
        <Text dimColor>No todos</Text>
      ) : (
        visibleTodos.map((todo, i) => (
          <Box key={i}>
            <Text color={STATUS_COLORS[todo.status]}>{STATUS_ICONS[todo.status]} </Text>
            <Text
              color={todo.status === 'in_progress' ? 'white' : undefined}
              dimColor={todo.status === 'completed'}
            >
              {todo.content.slice(0, 32)}
            </Text>
          </Box>
        ))
      )}
      {todos.length > 6 && <Text dimColor>+{todos.length - 6} more</Text>}
    </Box>
  );
}
