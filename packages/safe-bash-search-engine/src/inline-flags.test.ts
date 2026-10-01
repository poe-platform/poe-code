import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

for (const [source, input, expected] of [
  ["^(?i)foobar", "FOOBAR", "FOOBAR"],
  ["(?i:foo)bar", "FOOBAR", undefined],
  ["(?i:foo)bar", "FOObar", "FOObar"],
  ["(?i)foo(?-i:bar)baz", "FOObarBAZ", "FOObarBAZ"],
  ["(?i)foo(?-i)bar", "FOOBAR", undefined],
  ["(?i:[a-z]+)X", "ABCX", "ABCX"],
  ["(?i:[a-z]+)X", "ABCx", undefined],
  ["(?m)^bar", "foo\nbar", "bar"],
  ["(?-m)^bar", "foo\nbar", undefined],
  ["(?s)foo.bar", "foo\nbar", "foo\nbar"],
  ["(?s:foo.bar).baz", "foo\nbar\nbaz", undefined],
  ["(?s)foo.bar(?-s).baz", "foo\nbar\nbaz", undefined],
] as const) test(`search inline flags ${source} on ${JSON.stringify(input)}`, () => {
  const prepared = prepareErgonomicRegex([source], { kind: "rg", fixed: false, caseMode: "sensitive", whole: false, word: false, nullData: false, multiline: true });
  assert.equal(prepared.mode, "vm");
  if (prepared.mode !== "vm") assert.fail("expected inline flag matcher");
  const match = prepared.vm.matchBytes(new TextEncoder().encode(input), false)[0];
  assert.equal(match ? input.slice(match.start, match.end) : undefined, expected);
});
