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

for (const [input, shorthand] of [["é漢𠀀", "w"], ["٣𝟙", "d"], ["\u00a0\u2003", "s"]] as const) {
  test(`Unicode ${shorthand} shorthand across jq regex filters`, async () => {
    const pattern = JSON.stringify(`\\${shorthand}+`);
    const result = await run(["-M", "-c", `[test(${pattern}), match(${pattern}).string, scan(${pattern}), gsub(${pattern}; "x")]`], JSON.stringify(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify([true, input, input, "x"]) + "\n");
  });
}

test("jq Unicode word boundaries include supplementary characters", async () => {
  const result = await run(["-M", "-c", '[test("\\\\bé漢𠀀\\\\b"), test("é\\\\B漢\\\\B𠀀")]'], JSON.stringify("é漢𠀀"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "[true,true]\n");
});
