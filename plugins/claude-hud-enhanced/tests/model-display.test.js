import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatModelDisplay } from '../dist/render/model-display.js';

function ctx(display, authInfo = null, stdin = {}) {
  return {
    config: { display },
    authInfo,
    stdin,
    effortLevel: null,
    effortSymbol: null,
  };
}

const MAX = { method: 'Claude Max 20x', user: null };

test('formatModelDisplay: plain model when showAuthInModel is off', () => {
  assert.equal(formatModelDisplay('Opus 4.8', ctx({}, MAX)), 'Opus 4.8');
});

test('formatModelDisplay: folds the plan into the bracket when showAuthInModel', () => {
  assert.equal(
    formatModelDisplay('Opus 4.8', ctx({ showAuthInModel: true, showAuth: true }, MAX)),
    'Opus 4.8 | Claude Max 20x',
  );
});

test('formatModelDisplay: showAuthInModel with no auth info stays plain', () => {
  assert.equal(
    formatModelDisplay('Opus 4.8', ctx({ showAuthInModel: true, showAuth: true }, null)),
    'Opus 4.8',
  );
});

test('formatModelDisplay: showAuthInModel does not fold when showAuth is false', () => {
  assert.equal(
    formatModelDisplay('Opus 4.8', ctx({ showAuthInModel: true, showAuth: false }, MAX)),
    'Opus 4.8',
  );
});
