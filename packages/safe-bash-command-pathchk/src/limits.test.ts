import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./index.js";

test("resource limits default to Infinity and preserve explicit quotas", () => {
  const defaults = settings();
  assert.ok(Object.keys(defaults).length > 0);
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    for (const value of [Infinity, 16]) {
      assert.equal(settings({ limits: { [key]: value } })[key], value);
    }
    for (const value of [-Infinity, NaN, -1, 0, 1.5]) {
      assert.throws(() => settings({ limits: { [key]: value } }), RangeError);
    }
  }
});
