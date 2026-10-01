import assert from "node:assert/strict";
import test from "node:test";
import { defaultLimits, validateOptions } from "./options.js";

test("xan limit overrides retain defaults for undefined and accept Infinity", () => {
  for (const key of Object.keys(defaultLimits)) {
    assert.equal(defaultLimits[key as keyof typeof defaultLimits], Infinity);
    for (const value of [undefined, Infinity]) {
      assert.deepEqual(validateOptions({ limits: { [key]: value } }).limits, defaultLimits);
    }
    assert.equal(validateOptions({ limits: { [key]: 3 } }).limits[key as keyof typeof defaultLimits], 3);
    for (const value of [-Infinity, NaN, -1, 0, 0.5]) {
      assert.throws(() => validateOptions({ limits: { [key]: value } }), RangeError);
    }
  }
});
