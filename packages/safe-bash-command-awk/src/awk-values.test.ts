import assert from "node:assert/strict";
import test from "node:test";
import { string, inputValue, inputValueFromSlice } from "./awk-values.js";

test("dynamic scalars do not share tenant data through module caches", () => {
  for (const value of ["tenant-secret", "\ud800", "\u0100", "a\udfff"]) {
    assert.deepEqual(string(value), { kind: "string", text: value });
    assert.notEqual(string(value), string(value));
  }
  assert.notEqual(inputValue("secret"), inputValue("secret"));
  assert.notEqual(inputValueFromSlice("a secret b", 2, 8), inputValueFromSlice("a secret b", 2, 8));
});
