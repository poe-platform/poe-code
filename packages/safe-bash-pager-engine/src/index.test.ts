import assert from "node:assert/strict";
import test from "node:test";
import { createPagerCommand, settings } from "./index.js";

test("pager defaults to unlimited input with explicit quota validation", () => {
  assert.equal(settings().maxInputBytes, Infinity);
  assert.equal(settings({ limits: { maxInputBytes: 8 } }).maxInputBytes, 8);
  assert.throws(() => settings({ maxInputBytes: 0 }), RangeError);
  assert.equal(createPagerCommand("more").name, "more");
  assert.equal(createPagerCommand("less").name, "less");
});
