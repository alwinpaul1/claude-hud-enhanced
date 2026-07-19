import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateString } from '../dist/utils/truncate.js';

test('truncateString: short strings pass through unchanged', () => {
  assert.equal(truncateString('hello', 10), 'hello');
  assert.equal(truncateString('', 5), '');
  assert.equal(truncateString(null, 5), '');
});

test('truncateString: long strings get an ellipsis within the budget', () => {
  assert.equal(truncateString('abcdefghij', 6), 'abc...');
  assert.equal(truncateString('abcdefghij', 6).length, 6);
});

test('truncateString: does not split a surrogate pair at the boundary (no stray U+FFFD)', () => {
  // Each 🎉 is 2 UTF-16 units. A naive slice at an odd boundary would leave a
  // lone high surrogate before the ellipsis.
  const s = 'ab🎉🎉🎉🎉';
  const out = truncateString(s, 6); // budget 3 chars + '...'
  // No lone surrogate: every high surrogate must be followed by a low one.
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = out.charCodeAt(i + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, `lone high surrogate at ${i}`);
    }
  }
  assert.ok(out.endsWith('...'));
});
