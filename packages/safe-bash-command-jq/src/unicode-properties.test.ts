import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [input, property] of [["café", "L"], ["123", "N"], ["漢字", "Han"], ["𠀀", "Han"]] as const) {
  test(`Unicode ${property} properties across jq regex filters on ${input}`, async () => {
    const pattern = JSON.stringify(`\\p{${property}}+`);
    const result = await run(["-M", "-c", `[test(${pattern}), match(${pattern}).string, scan(${pattern}), gsub(${pattern}; "x")]`], JSON.stringify(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify([true, input, input, "x"]) + "\n");
  });
}
