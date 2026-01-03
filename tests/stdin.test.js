import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStdin } from '../dist/stdin.js';

test('readStdin returns null for TTY input', async () => {
  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

test('readStdin returns null on stream errors', async () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetEncoding = process.stdin.setEncoding;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  process.stdin.setEncoding = () => {
    throw new Error('boom');
  };

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    process.stdin.setEncoding = originalSetEncoding;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});
