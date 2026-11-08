import assert from 'node:assert/strict';
export function exactStrings(value) {
  assert.ok(Array.isArray(value), 'argument array required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert.ok(Object.hasOwn(descriptors.length, 'value'));
  const length = descriptors.length.value;
  assert.ok(Number.isSafeInteger(length) && length >= 0 && length <= 16);
  const keys = ['length', ...Array.from({ length }, (_, index) => String(index))];
  assert.deepEqual(Reflect.ownKeys(descriptors).sort(), keys.sort());
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    assert.ok(Object.hasOwn(descriptor, 'value'), 'argument accessor refused');
    assert.equal(typeof descriptor.value, 'string');
    return descriptor.value;
  });
}
export function internalLoaderArguments(value, paths) {
  const args = exactStrings(value);
  const expected = ['--test-reporter=tap', ...(args.length === 5 ? ['--test-timeout=30000'] : []), '--loader', paths.loader, paths.consumer];
  assert.deepEqual(args, expected, 'exact loader/consumer arguments required');
  for (const field of ['root', 'loader', 'bootstrap', 'consumer']) assert.equal(typeof paths[field], 'string');
  return ['--experimental-permission', '--allow-fs-read=' + paths.root, '--allow-fs-write=' + paths.root, '--allow-worker', '--import', paths.bootstrap, ...args];
}

