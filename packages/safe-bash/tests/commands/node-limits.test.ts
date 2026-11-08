import assert from 'node:assert/strict';
import { test } from 'node:test';
test('every Node quota accepts explicit Infinity while invalid budgets remain rejected', async () => {
  const { resolveNodeLimits, nodeLimits } = await import('../../src/commands/node/types.js');
  for (const name of Object.keys(nodeLimits).filter(name => name !== 'sabBytes')) {
    assert.equal(Reflect.get(resolveNodeLimits({ [name]: Infinity }), name), Infinity);
    for (const value of [-Infinity, NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => resolveNodeLimits({ [name]: value }), RangeError);
    }
  }
  assert.throws(() => resolveNodeLimits({ sabBytes: Infinity } as never), TypeError);
});
