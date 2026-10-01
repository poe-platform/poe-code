import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./options.js";

test("settings accepts omitted options with unlimited defaults", () => {
  assert.deepEqual(settings(), { maxInputBytes: Infinity, maxSampleSize: Infinity });
  assert.deepEqual(settings({ maxInputBytes: 16, maxSampleSize: 2 }), { maxInputBytes: 16, maxSampleSize: 2 });
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) {
    assert.throws(() => settings({ maxInputBytes: value }), RangeError);
    assert.throws(() => settings({ maxSampleSize: value }), RangeError);
  }
});

test("nested shuf limits override legacy options and validate resolved values", () => {
  assert.deepEqual(settings({ limits: { maxInputBytes: 8, maxSampleSize: 2 } }), { maxInputBytes: 8, maxSampleSize: 2 });
  assert.deepEqual(settings({ maxInputBytes: 1, maxSampleSize: 1, limits: { maxInputBytes: Infinity, maxSampleSize: Infinity } }), settings());
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) {
    assert.throws(() => settings({ limits: { maxInputBytes: value } }), RangeError);
    assert.throws(() => settings({ limits: { maxSampleSize: value } }), RangeError);
  }
});
