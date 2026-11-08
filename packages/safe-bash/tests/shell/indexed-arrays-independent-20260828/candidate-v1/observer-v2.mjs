import assert from 'node:assert/strict';

export function ownData(value, keys) {
  assert.ok(value !== null && typeof value === 'object', 'own-data object');
  const actual = Reflect.ownKeys(value);
  assert.ok(actual.every(key => typeof key === 'string'), 'no symbol extras');
  assert.deepEqual(actual.sort(), [...keys].sort(), 'exact own keys');
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'data property, not accessor');
  return value;
}
export function dataField(value, key) {
  assert.ok(value !== null && (typeof value === 'object' || typeof value === 'function'));
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  assert.ok(descriptor && Object.hasOwn(descriptor, 'value'), `own data ${key}`);
  return descriptor.value;
}
export function namedBinding(value) {
  ownData(value, ['binding', 'name', 'admission']);
  assert.ok(value.binding !== null && typeof value.binding === 'object', 'IndexedBinding value');
  const values = dataField(value.binding, 'values');
  const size = Reflect.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(values);
  assert.ok(size <= 64, 'bounded observer slots');
  const result = [];
  for (const [index, element] of Map.prototype.entries.call(values)) {
    assert.ok(Number.isSafeInteger(index) && index >= 0 && index <= 2147483647);
    ownData(element, ['text', 'slot']);
    const text = dataField(element.text, 'value');
    assert.equal(typeof text, 'string'); assert.ok(text.length <= 4096, 'bounded observer text');
    result.push([index, text]);
  }
  return result.sort((left, right) => left[0] - right[0]);
}
export function installTerminalObserver(roles) {
  ownData(roles, ['monitorPrototype', 'ownerPrototype', 'ownerFor', 'isRoot', 'capture', 'terminal']);
  for (const key of ['ownerFor', 'isRoot', 'capture', 'terminal']) assert.equal(typeof roles[key], 'function');
  const activateDescriptor = Object.getOwnPropertyDescriptor(roles.monitorPrototype, 'activate');
  const closeDescriptor = Object.getOwnPropertyDescriptor(roles.ownerPrototype, 'close');
  for (const descriptor of [activateDescriptor, closeDescriptor]) {
    assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.configurable && descriptor.writable);
    assert.equal(typeof descriptor.value, 'function');
  }
  const monitors = new Set(), roots = new Set(), captures = [], pending = [];
  const observerErrors = [], originalErrors = [];
  const observeError = reason => { if (observerErrors.length < 64) observerErrors.push({ reason }); };
  let restored = false;
  const activate = function (...args) {
    const result = Reflect.apply(activateDescriptor.value, this, args);
    try { assert.ok(monitors.has(this) || monitors.size < 64); monitors.add(this); }
    catch (reason) { observeError(reason); }
    return result;
  };
  const close = function (...args) {
    try {
      const root = roles.isRoot(this); assert.equal(typeof root, 'boolean');
      if (root && !roots.has(this)) {
        assert.ok(roots.size < 64); roots.add(this);
        for (const monitor of monitors) if (roles.ownerFor(monitor) === this) {
          assert.ok(captures.length < 64); captures.push(roles.capture(monitor));
        }
      }
    } catch (reason) { observeError(reason); }
    let result;
    try { result = Reflect.apply(closeDescriptor.value, this, args); }
    catch (reason) { originalErrors.push({ reason }); throw reason; }
    try {
      assert.ok(pending.length < 512, 'finite observed close returns');
      pending.push(Promise.prototype.then.call(result, () => undefined, reason => { originalErrors.push({ reason }); }));
    } catch (reason) { observeError(reason); }
    return result;
  };
  Object.defineProperty(roles.monitorPrototype, 'activate', { ...activateDescriptor, value: activate });
  try { Object.defineProperty(roles.ownerPrototype, 'close', { ...closeDescriptor, value: close }); }
  catch (reason) { Object.defineProperty(roles.monitorPrototype, 'activate', activateDescriptor); throw reason; }
  const settle = async () => {
    for (let cursor = 0; cursor < pending.length;) { const end = pending.length; await Promise.all(pending.slice(cursor, end)); cursor = end; }
    if (originalErrors.length) throw originalErrors[0].reason;
    if (observerErrors.length) throw observerErrors[0].reason;
  };
  return {
    async after() { await settle(); return roles.terminal({ monitors: [...monitors], roots: [...roots], captures: [...captures] }); },
    async close() {
      if (!restored) {
        Object.defineProperty(roles.monitorPrototype, 'activate', activateDescriptor);
        Object.defineProperty(roles.ownerPrototype, 'close', closeDescriptor);
        restored = true;
      }
      await settle();
    }
  };
}
