import assert from "node:assert/strict";
import test from "node:test";
import { createLessCommand, settings } from "./index.js";

test("less command definition exports standard contract", () => {
  const def = createLessCommand();
  assert.equal(def.name, "less");
  assert.equal(typeof def.execute, "function");
});

test("less input quotas are optional with equivalent flat and nested options", () => {
  assert.equal(settings().maxInputBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxInputBytes: value }).maxInputBytes, value);
    assert.equal(settings({ limits: { maxInputBytes: value } }).maxInputBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ maxInputBytes: value }), RangeError);
});
