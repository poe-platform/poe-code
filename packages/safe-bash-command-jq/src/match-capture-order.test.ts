import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [pattern, capture] of [
  ["(a)?(b)?(z)?", '{"offset":-1,"string":null,"length":0,"name":null}'],
  ["(a)?(b)?(?<x>z)?", '{"offset":-1,"string":null,"length":0,"name":"x"}'],
] as const) {
  test(`match preserves native jq capture field order for ${pattern}`, async () => {
    const result = await run(["-cn", `"abc" | match(${JSON.stringify(pattern)}) | (.captures[2] | keys_unsorted), .captures[2], (.captures[0] | keys_unsorted)`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["offset","string","length","name"]\n' + capture + '\n["offset","length","string","name"]\n');
  });
}
