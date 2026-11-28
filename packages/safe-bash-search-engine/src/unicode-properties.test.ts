import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

const config = { kind: "rg", fixed: false, caseMode: "sensitive", whole: false, word: false, nullData: false } as const;

for (const pattern of [String.raw`\p`, String.raw`\p{}`, String.raw`\p{L`, String.raw`\p{NotAProperty}`, String.raw`[\p{L}-z]`, String.raw`\p{L|.*}`]) {
  test(`rejects malformed Unicode property ${pattern}`, () => {
    assert.throws(() => prepareErgonomicRegex([pattern], config));
  });
}

test("Unicode property classes identify cross-line matches", () => {
  const prepared = prepareErgonomicRegex([String.raw`\P{L}+`], { ...config, multiline: true });
  if (prepared.mode !== "vm") assert.fail("expected VM matcher");
  assert.equal(prepared.crossLine, true);
  assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode("a1\n2b"), true), [{ start: 1, end: 4 }]);
});

test("grep keeps literal property escapes outside Perl mode", () => {
  const prepared = prepareErgonomicRegex([String.raw`\pN`], { ...config, kind: "grep", extended: true, forceVm: true });
  if (prepared.mode !== "vm") assert.fail("expected VM matcher");
  assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode("pN"), true), [{ start: 0, end: 2 }]);
});
