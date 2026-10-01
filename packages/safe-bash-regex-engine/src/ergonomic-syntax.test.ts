import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };
for (const dialect of ["sed", "awk", "jq"] as const) {
  for (const [source, input, expected] of [
    ["[\\d]+", "foo 123", "123"], ["[\\D]+", "123abc", "abc"],
    ["[\\s]+", "a \tb", " \t"], ["[^\\s]+", " abc ", "abc"],
    ["[\\S]+", " abc ", "abc"], ["[\\w]+", "!a_1", "a_1"],
    ["[\\W]+", "a_1!?", "!?"], ["[a\\d]+", "!a123", "a123"],
    ["[\\d\\s]+", "x 12", " 12"],
  ]) test(`${dialect} bracket ${source}`, async () => {
    assert.equal((await new Pattern(source!, true, false, dialect).find(input!, budget))?.groups[0], expected);
  });
}
test("BRE non-capturing groups preserve capture numbering", async () => {
  const pattern = new Pattern("\\(?:foo\\)\\(bar\\)", false);
  assert.deepEqual((await pattern.find("foobar", budget))?.groups, ["foobar", "bar"]);
});
for (const dialect of ["jq", "rust"] as const) {
  for (const [source, input, expected] of [
    ["^(?i)readme", "README", "README"],
    ["(?i:readme)\\.md", "README.md", "README.md"],
    ["(?i:foo)bar", "FOOBAR", undefined],
    ["(?i)foo(?-i)bar", "FOObar", "FOObar"],
    ["(?i)foo(?-i:bar)baz", "FOObarBAZ", "FOObarBAZ"],
    ["(?i)foo(?-i:bar)baz", "FOOBARBAZ", undefined],
    ["(?m)^bar", "foo\nbar", "bar"],
    ["(?s)foo.bar", "foo\nbar", "foo\nbar"],
    ["(?s:foo.bar).baz", "foo\nbar\nbaz", undefined],
    ["(?i:(a))\\1", "aA", undefined],
  ]) test(`${dialect} inline flags ${source} on ${JSON.stringify(input)}`, async () => {
    assert.equal((await new Pattern(source!, true, false, dialect).find(input!, budget))?.groups[0], expected);
  });
}
