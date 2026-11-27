import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };
for (const [source, input, expected, start] of [
  ["a|aa", "aa", "aa", 0],
  ["a|bb", "abb", "bb", 1],
  ["a+?", "aaa", "aaa", 0],
  ["a|b", "ab", "a", 0],
  ["(?>a|aa)", "aa", "a", 0],
  ["a|😀😀", "a😀😀", "😀😀", 1],
  ["aaa|😀", "aaa😀", "😀", 3],
] as const) {
  test(`jq longest match: ${source} on ${JSON.stringify(input)}`, async () => {
    const match = await new Pattern(source, true, false, "jq", "l").find(input, budget);
    assert.equal(match?.groups[0], expected);
    assert.equal(match?.start, start);
  });
}

test("jq longest match retains captures from the selected alternative", async () => {
  const match = await new Pattern("(?<short>a)|(?<long>aa)", true, false, "jq", "l").find("aa", budget);
  assert.deepEqual(match?.groups, ["aa", undefined, "aa"]);
});

test("jq without l keeps the first alternative", async () => {
  assert.equal((await new Pattern("a|aa", true, false, "jq").find("aa", budget))?.groups[0], "a");
});
