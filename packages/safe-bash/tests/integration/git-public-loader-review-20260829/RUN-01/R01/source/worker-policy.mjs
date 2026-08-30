import assert from 'node:assert/strict';
export function ownData(value, keys) {
  assert.ok(value !== null && typeof value === 'object');
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  assert.ok(actual.every(key => typeof key === 'string')); assert.deepEqual(actual.sort(), [...keys].sort());
  for (const key of keys) assert.ok(Object.hasOwn(descriptors[key], 'value'), 'accessor refused');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export function admitWorker(entry, expected, options, created, live, allowance) {
  assert.equal(typeof entry, 'string'); assert.equal(entry, expected);
  assert.ok(Number.isSafeInteger(allowance) && allowance >= 0 && allowance <= 32);
  assert.ok(Number.isSafeInteger(created) && created >= 0 && created < allowance);
  assert.ok(Number.isSafeInteger(live) && live >= 0 && live < 2);
  const fields = ownData(options, ['execArgv', 'resourceLimits']); assert.ok(Array.isArray(fields.execArgv));
  assert.equal(ownData(fields.execArgv, ['length']).length, 0);
  const limits = ownData(fields.resourceLimits, ['maxOldGenerationSizeMb', 'stackSizeMb']);
  assert.equal(limits.maxOldGenerationSizeMb, 128); assert.equal(limits.stackSizeMb, 4); return true;
}
export function terminalVerdict(code, signal, live, complete, pass) { return code === 0 && signal === null && live === 0 && complete === true && pass === true; }
