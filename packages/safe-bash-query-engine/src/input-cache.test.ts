import assert from "node:assert/strict";
import { test } from "node:test";
import { tryProcessFlatSelectProjectChunkSync } from "./input.js";
import { Budget, defaultJqLimits } from "./limits.js";

test("select/project checks all bytes when a source identity is reused", () => {
  const encoder = new TextEncoder();
  const original = Array.from({ length: 20 }, (_, id) => JSON.stringify({ id, active: true, val: "FIRST_SECRET_VALUE" })).join("\n") + "\n";
  const source = encoder.encode(original);
  const holder = {};
  const run = (input: Uint8Array) => {
    const output = new Uint8Array(65536);
    const budget = new Budget(defaultJqLimits, new AbortController().signal);
    const length = tryProcessFlatSelectProjectChunkSync(input, budget, "active", ["id", "val"], ["id", "val"], output, holder, source);
    assert.ok(length > 0);
    return new TextDecoder().decode(output.subarray(0, length));
  };
  assert.ok(run(source.slice()).includes("FIRST_SECRET_VALUE"));
  source.set(encoder.encode("SECOND_NEW_VALUE!"), original.indexOf("FIRST_SECRET_VALUE", original.indexOf("\n") + 1));
  assert.ok(run(source.slice()).includes("SECOND_NEW_VALUE!"));
});
