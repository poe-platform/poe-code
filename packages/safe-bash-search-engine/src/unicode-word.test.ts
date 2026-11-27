import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

for (const kind of ["rg", "grep"] as const) {
  test(`${kind} retains its word dialect and UTF-8 boundary offsets`, () => {
    for (const pattern of [String.raw`\w+`, String.raw`\b\w+\b`]) {
      const prepared = prepareErgonomicRegex([pattern], {
        kind, fixed: false, extended: true, caseMode: "sensitive",
        whole: false, word: false, nullData: false, forceVm: true,
      });
      assert.equal(prepared.mode, "vm");
      if (prepared.mode !== "vm") assert.fail("expected VM");
      assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode("éx"), true),
        [{ start: kind === "rg" ? 0 : 2, end: 3 }]);
    }
  });
}

test("rg boundaries do not match inside a UTF-8 scalar", () => {
  for (const pattern of [String.raw`\b`, String.raw`\B`]) {
    const prepared = prepareErgonomicRegex([pattern], {
      kind: "rg", fixed: false, caseMode: "sensitive",
      whole: false, word: false, nullData: false, forceVm: true,
    });
    if (prepared.mode !== "vm") assert.fail("expected VM");
    assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode("𐐀é"), true),
      (pattern === String.raw`\b` ? [0, 6] : [4]).map(start => ({ start, end: start })));
  }
});
