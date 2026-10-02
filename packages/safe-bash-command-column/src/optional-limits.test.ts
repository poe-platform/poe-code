import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./options.js";

test("column limits accept omitted, undefined and Infinity while validating finite opt-ins", () => {
  const defaults = settings({});
  for (const [key, value] of Object.entries(defaults)) {
    assert.equal(value, Infinity, key);
    for (const disabled of [undefined, Infinity]) {
      assert.deepEqual(settings({ limits: { [key]: disabled } }), defaults);
    }
    assert.deepEqual(settings({ limits: { [key]: 8 } }), { ...defaults, [key]: 8 });
    for (const invalid of [0, -1, NaN, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => settings({ limits: { [key]: invalid } }), RangeError);
    }
  }
});
