import assert from 'node:assert/strict';

export function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, release: value => resolve(value) };
}
export function patches() {
  const restores = [];
  return {
    replace(target, key, factory) {
      assert.ok(restores.length < 16);
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.writable && descriptor.configurable);
      assert.equal(typeof descriptor.value, 'function');
      const replacement = factory(descriptor.value); assert.equal(typeof replacement, 'function');
      Object.defineProperty(target, key, { ...descriptor, value: replacement });
      restores.push(() => Object.defineProperty(target, key, descriptor));
    },
    restore() { while (restores.length) restores.pop()(); }
  };
}
export function requireOwnData(value, keys) {
  assert.ok(value !== null && typeof value === 'object');
  assert.deepEqual(Reflect.ownKeys(value), keys);
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
export function serializePublicAst(value, seen = new Set(), budget = { remaining: 20000 }) {
  assert.ok(--budget.remaining >= 0);
  if (value === null || typeof value !== 'object') {
    assert.ok(['undefined','string','boolean','number'].includes(typeof value) || value === null);
    if (value === undefined) return { primitive: 'undefined' };
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    if (typeof value === 'string') assert.ok(value.length <= 65536);
    return { primitive: typeof value, value };
  }
  assert.ok(!seen.has(value), 'public AST must be finite acyclic data'); seen.add(value);
  const result = { array: Array.isArray(value), keys: [] };
  for (const key of Reflect.ownKeys(value)) {
    assert.equal(typeof key, 'string', 'no new private symbols on public AST');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(Object.hasOwn(descriptor, 'value'), 'public AST data, not getters');
    result.keys.push([key, descriptor.enumerable, descriptor.configurable, descriptor.writable, serializePublicAst(descriptor.value, seen, budget)]);
  }
  seen.delete(value); return result;
}
