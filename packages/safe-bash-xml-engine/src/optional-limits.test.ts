import assert from "node:assert/strict";
import test from "node:test";
import { resolveXmlQueryLimits } from "./limits.js";

test("XML query limits are opt-in and accept explicit Infinity", () => {
  const defaults = resolveXmlQueryLimits();
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    assert.equal(resolveXmlQueryLimits({ [key]: Infinity })[key], Infinity);
    assert.equal(resolveXmlQueryLimits({ [key]: 3 })[key], 3);
    for (const value of [-1, -Infinity, NaN, 0, 0.5]) assert.throws(() => resolveXmlQueryLimits({ [key]: value }), RangeError);
  }
});
