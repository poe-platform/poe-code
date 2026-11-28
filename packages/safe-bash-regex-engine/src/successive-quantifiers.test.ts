import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };

for (const dialect of ["sed", "awk"] as const) {
  for (const [source, input, expected] of [
    ["a+?", "aaa", "aaa"],
    ['".*?"', 'x "a" y "b" z', '"a" y "b"'],
    ["a*?b", "aab", "aab"],
    ["a{1,2}{2}", "aaaaa", "aaaa"],
    ["a{2}{3}", "aaaaaaa", "aaaaaa"],
    ["a+?", "b", ""],
    ["a?+", "aaa", "aaa"],
    ["a+?*", "aaa", "aaa"],
    ["(ab){1,2}{2}", "ababababab", "abababab"],
    [String.raw`a+\?`, "aaa?", "aaa?"],
  ]) test(`${dialect} successive quantifiers: ${source}`, async () => {
    assert.equal((await new Pattern(source!, true, false, dialect).find(input!, budget))?.groups[0], expected);
  });

  test(`${dialect} successive intervals retain instruction limits`, () => {
    assert.throws(() => new Pattern("a{100}{100}", true, false, dialect, "", { maxPatternInstructions: 1000 }), /program limit/u);
  });
}

test("sed BRE applies escaped quantifiers to the preceding repetition", async () => {
  assert.equal((await new Pattern(String.raw`a\+\?`, false).find("aaa", budget))?.groups[0], "aaa");
});

for (const dialect of ["jq", "rust"] as const) {
  test(`${dialect} retains lazy repetition`, async () => {
    assert.equal((await new Pattern("a+?", true, false, dialect).find("aaa", budget))?.groups[0], "a");
  });
}

test("jq still rejects unsupported successive quantifiers", () => {
  assert.throws(() => new Pattern("a{1,2}{2}", true, false, "jq"), /nested quantifier/u);
});
