import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./index.js";
test("metadata limits are optional", () => { assert.equal(settings().limits.maxDepth, Infinity); assert.equal(settings({ limits: { maxDepth: 2 } }).limits.maxDepth, 2); });

test("metadata limits accept undefined and Infinity while validating finite opt-ins", () => {
  const defaults = settings().limits;
  for (const [key, value] of Object.entries(defaults)) {
    assert.equal(value, Infinity, key);
    for (const disabled of [undefined, Infinity]) {
      assert.deepEqual(settings({ limits: { [key]: disabled } }).limits, defaults);
    }
    assert.deepEqual(settings({ limits: { [key]: 8 } }).limits, { ...defaults, [key]: 8 });
    for (const invalid of [-1, NaN, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => settings({ limits: { [key]: invalid } }), RangeError);
    }
  }
});
