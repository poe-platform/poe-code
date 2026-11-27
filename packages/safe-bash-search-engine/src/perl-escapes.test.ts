import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

const config = { kind: "grep", fixed: false, extended: true, caseMode: "sensitive", whole: false, word: false, nullData: false, forceVm: true } as const;

for (const pattern of [String.raw`\x`, String.raw`\x6g`, String.raw`\x{}`, String.raw`\x{61`, String.raw`\x{gg}`, String.raw`\x{110000}`, String.raw`[\x{D800}]`]) {
  test(`rg rejects malformed hex escape ${pattern}`, () => {
    assert.throws(() => prepareErgonomicRegex([pattern], { ...config, kind: "rg" }), /hexadecimal escape/u);
  });
}

for (const pattern of [String.raw`\x`, String.raw`\x6g`, String.raw`[\xgg]`]) {
  test(`Perl mode rejects malformed hex escape ${pattern}`, () => {
    assert.throws(() => prepareErgonomicRegex([pattern], { ...config, perl: true }), /hexadecimal escape/u);
  });
}

for (const [pattern, input] of [[String.raw`\K`, "K"], [String.raw`\x61`, "x61"], [String.raw`\Q.\E`, "Q.E"]]) {
  test(`non-Perl mode preserves escape behavior for ${pattern}`, () => {
    const prepared = prepareErgonomicRegex([pattern!], config);
    if (prepared.mode !== "vm") assert.fail("expected VM matcher");
    assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode(input), true), [{ start: 0, end: input!.length }]);
  });
}
