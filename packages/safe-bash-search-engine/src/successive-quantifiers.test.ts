import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

for (const [kind, perl, extended, pattern, input, expected] of [
  ["grep", false, true, "a+?", "aab", ["aa"]],
  ["grep", false, true, '".*?"', 'x "a" "b" y', ['"a" "b"']],
  ["grep", false, true, "a*?", "aaa", ["aaa"]],
  ["grep", false, false, String.raw`a\+\?`, "aab", ["aa"]],
  ["grep", false, true, "ba+?b", "bb baab", ["bb", "baab"]],
  ["grep", true, true, "a+?", "aab", ["a", "a"]],
  ["rg", false, true, "a+?", "aab", ["a", "a"]],
  ["rg", false, true, '".*?"', 'x "a" "b" y', ['"a"', '"b"']],
] as const) {
  test(`${kind} VM respects successive quantifiers: ${pattern} (Perl: ${perl})`, () => {
    const prepared = prepareErgonomicRegex([pattern], {
      kind, perl, extended, fixed: false, caseMode: "sensitive",
      whole: false, word: false, nullData: false, forceVm: true,
    });
    if (prepared.mode !== "vm") assert.fail("expected VM");
    const matches = prepared.vm.matchBytes(new TextEncoder().encode(input), true);
    assert.deepEqual(matches.filter(match => match.start !== match.end)
      .map(match => input.slice(match.start, match.end)), expected);
  });
}
