import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

for (const [pattern, input, expected] of [
  [String.raw`(a)\1`, "aa ab", ["aa"]],
  [String.raw`(a|ab)\1`, "abab", ["abab"]],
  [String.raw`(a+)\1`, "aaaa", ["aaaa"]],
  [String.raw`(ab|a)b\1`, "aba", ["aba"]],
  [String.raw`(🦊)\1`, "🦊🦊", ["🦊🦊"]],
  [String.raw`(?i)(ab)\1`, "abAB", ["abAB"]],
  [String.raw`(a)?b\1`, "b", []],
  [String.raw`()\1a`, "a", ["a"]],
  [String.raw`(a)\1(?=b)`, "aab", ["aa"]],
  [String.raw`(a)\1`, "ab", []],
] as const) {
  test(`Perl backreference: ${pattern} on ${input}`, () => {
    const prepared = prepareErgonomicRegex([pattern], {
      kind: "rg", perl: true, fixed: false, caseMode: "sensitive",
      whole: false, word: false, nullData: false,
    });
    assert.equal(prepared.mode, "vm");
    if (prepared.mode !== "vm") return;
    const bytes = new TextEncoder().encode(input);
    const matches = prepared.vm.matchBytes(bytes, true);
    assert.deepEqual(matches.map(match => new TextDecoder().decode(bytes.subarray(match.start, match.end))), expected);
  });
}

test("backreference searches enforce an execution budget", () => {
  const prepared = prepareErgonomicRegex([String.raw`(a+)b\1`], {
    kind: "rg", perl: true, fixed: false, caseMode: "sensitive",
    whole: false, word: false, nullData: false,
  });
  assert.equal(prepared.mode, "vm");
  if (prepared.mode !== "vm") return;
  assert.throws(() => prepared.vm.matchBytes(new TextEncoder().encode("a".repeat(1000)), true), /execution limit exceeded/);
});
