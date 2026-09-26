import assert from "node:assert/strict";
import test from "node:test";
import { createBcCommand, settings } from "./index.js";

test("bc command definition exports standard contract", () => {
  const def = createBcCommand();
  assert.equal(def.name, "bc");
  assert.equal(typeof def.execute, "function");
});

test("bc resource quotas are optional with equivalent flat and nested options", () => {
  const defaults = settings();
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    for (const value of [Infinity, 16]) {
      assert.equal(settings({ [key]: value })[key], value);
      assert.equal(settings({ limits: { [key]: value } })[key], value);
    }
    for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ [key]: value }), RangeError);
  }
});
