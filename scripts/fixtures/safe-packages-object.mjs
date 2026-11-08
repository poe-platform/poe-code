import assert from "node:assert/strict";
import { createRealm, run } from "@poe-platform/safe-js/core";
import { dump, restore } from "@poe-platform/safe-js";

const source = `
  const class2type = {};
  const core_toString = class2type.toString;
  for (const name of 'Boolean Number String Function Array Date RegExp Object Error'.split(' ')) {
    class2type['[object ' + name + ']'] = name.toLowerCase();
  }
  function type(obj) {
    return obj == null ? String(obj) :
      typeof obj === 'object' || typeof obj === 'function' ?
      class2type[core_toString.call(obj)] || 'object' : typeof obj;
  }
  return [type([]), type(function () {}), type(new Date(0)), type(null), type({}),
    Object.getPrototypeOf({}) === Object.prototype,
    Object.prototype.hasOwnProperty.call(Object, 'kind'),
    Object.getPrototypeOf(Object.prototype) === null];
`;
const first = await run(source);
assert.equal(first.ok, true);
assert.deepEqual(first.returnValue, ["array", "function", "date", "null", "object", true, false, true]);
const replayed = await run(source, { snapshot: restore(JSON.parse(await dump(first)), { source }) });
assert.equal(replayed.ok, true);
assert.deepEqual(replayed.returnValue, first.returnValue);

const realm = createRealm();
const isolated = createRealm();
try {
  await realm.evaluate("Object.prototype.shared = 7;");
  assert.equal((await realm.evaluate("return ({}).shared;")).returnValue, 7);
  assert.equal((await isolated.evaluate("return ({}).shared;")).returnValue, undefined);
  assert.equal(Object.hasOwn(Object.prototype, "shared"), false);
  await assert.rejects(realm.evaluate("({}).constructor.constructor('return process')();"));
} finally {
  await realm.close();
  await isolated.close();
}
console.log("Public Object type inspection, jQuery-style lookup, replay and realm isolation passed");
