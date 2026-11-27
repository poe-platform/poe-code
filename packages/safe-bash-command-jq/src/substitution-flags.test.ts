import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [filter, expected] of [
  ['"aaa" | gsub("a"; "b"; "x")', "bbb"],
  ['"a b" | sub("a b"; "Z"; "x")', "a b"],
  ['"ab ab" | sub("a b # comment"; "Z"; "x")', "Z ab"],
  ['"ab ab" | gsub("a b # comment"; "Z"; "x")', "Z Z"],
  ['"a b" | sub("a[ ]b"; "Z"; "x")', "Z"],
  ['"a\\nb a\\nb" | sub("a.b"; "Z"; "p")', "Z a\nb"],
  ['"a\\nb a\\nb" | gsub("a.b"; "Z"; "p")', "Z Z"],
  ['"a\\nb" | sub("^a.b$"; "Z"; "p")', "Z"],
  ['"a\\nb" | sub("^b"; "Z"; "p")', "a\nb"],
  ['"aa" | sub("a|aa"; "Z"; "l")', "Z"],
  ['"aa aa" | gsub("a|aa"; "Z"; "l")', "Z Z"],
  ['"abb" | sub("a|bb"; "Z"; "l")', "aZ"],
  ['"aaa" | sub("a+?"; "Z"; "l")', "Z"],
  ['"aa" | sub("(?<short>a)|(?<long>aa)"; .long; "l")', "aa"],
  ['"aa" | sub("(?>a|aa)"; "Z"; "l")', "Za"],
  ['"AA" | gsub("a | aa"; "Z"; "xil")', "Z"],
] as const) {
  test(`jq substitution flags: ${filter}`, async () => {
    const result = await run(["-nc", filter]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify(expected) + "\n");
  });
}
