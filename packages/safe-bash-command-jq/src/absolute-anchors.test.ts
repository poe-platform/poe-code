import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [input, source] of [["abc", "\\Aabc"], ["abc", "abc\\z"], ["abc\n", "abc\\Z"]] as const) {
  test(`absolute anchors across jq regex filters: ${source}`, async () => {
    const pattern = JSON.stringify(source);
    const result = await run(["-M", "-c", `[test(${pattern}), match(${pattern}).string, scan(${pattern}), gsub(${pattern}; "x")]`], JSON.stringify(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify([true, "abc", "abc", input.replace("abc", "x")]) + "\n");
  });
}
