import assert from 'node:assert/strict';
import test from 'node:test';

test('pr can load before request-scoped AbortController construction is permitted', async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = new Proxy(original, { construct() { throw new Error('AbortController requires a request scope'); } });
  let module: typeof import('../../src/commands/pr/index.js');
  try {
    const source = '../../src/commands/pr/index.js?request-scope';
    module = await import(source) as typeof module;
  } finally { globalThis.AbortController = original; }
  assert.equal(module.evalSyncPr(new TextEncoder().encode('one\ntwo\n'), ['-t']), 'one\ntwo');
});
