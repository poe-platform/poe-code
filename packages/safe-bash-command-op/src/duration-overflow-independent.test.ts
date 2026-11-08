import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpDuration } from "./duration.js";

test("duration acceptance preserves the native unsigned accumulator wrap boundary", () => {
  for (const value of [
    "9223372036854775808ns9223372036854775808ns",
    "-9223372036854775808ns9223372036854775808ns",
  ]) assert.equal(isOpDuration(value), true, value);
});

test("nearby nonwrapping duration overflows remain rejected", () => {
  for (const value of [
    "9223372036854775808ns9223372036854775807ns",
    "9223372036854775807ns1ns",
  ]) assert.equal(isOpDuration(value), false, value);
});
