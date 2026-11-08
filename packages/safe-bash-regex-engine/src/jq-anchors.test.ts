import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };
for (const [source, input, expected] of [
  ["\\Aabc", "abc", "abc"],
  ["\\Aabc", "xabc", undefined],
  ["(?m)\\Aabc", "x\nabc", undefined],
  ["abc\\z", "abc", "abc"],
  ["abc\\z", "abc\n", undefined],
  ["(?m)abc\\z", "abc\nx", undefined],
  ["abc\\Z", "abc", "abc"],
  ["abc\\Z", "abc\n", "abc"],
  ["abc\\Z", "abc\n\n", undefined],
  ["abc\\Z", "abc\r\n", undefined],
  ["(?m)abc\\Z", "abc\nx", undefined],
  ["\\A\\z", "", ""],
  ["\\A\\Z", "\n", ""],
  ["\\\\A", "\\A", "\\A"],
  ["[AzZ]", "Z", "Z"],
] as const) test(`jq absolute anchors: ${source} on ${JSON.stringify(input)}`, async () => {
  assert.equal((await new Pattern(source, true, false, "jq").find(input, budget))?.groups[0], expected);
});

test("jq absolute beginning does not restart at the search offset", async () => {
  assert.equal(await new Pattern("\\Aabc", true, false, "jq").find("xabc", budget, 1), undefined);
});
