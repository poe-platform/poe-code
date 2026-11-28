import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

for (const kind of ["grep", "rg"] as const) {
  for (const perl of [false, true]) {
    for (const [name, input, expected] of [
      ["alpha", "é中١１\u0345ⅧⅷⓐⒶ1_😀", "é中١１\u0345ⅧⅷⓐⒶ"],
      ["alnum", "é中١１\u0345ⅧⅷⓐⒶ1_😀", "é中١１\u0345ⅧⅷⓐⒶ1"],
      ["upper", "ÀéΣσ𐐀𐐨ⅧⅷⓐⒶA", "ÀΣ𐐀ⅧⒶA"],
      ["lower", "ÀéΣσ𐐀𐐨ⅧⅷⓐⒶa", "éσ𐐨ⅷⓐa"],
      ["digit", "١１1", "1"],
    ] as const) {
      test(`${kind} perl=${perl} preserves its POSIX ${name} dialect`, () => {
        const prepared = prepareErgonomicRegex([`[[:${name}:]]`], {
          kind, perl, extended: true, fixed: false, caseMode: "sensitive",
          whole: false, word: false, nullData: false, forceVm: true,
        });
        if (prepared.mode !== "vm") assert.fail("expected VM matcher");
        const bytes = new TextEncoder().encode(input);
        const matches = prepared.vm.matchBytes(bytes, true);
        const output = matches.map(({ start, end }) => new TextDecoder().decode(bytes.subarray(start, end))).join("");
        assert.equal(output, kind === "grep" && !perl ? expected : [...expected].filter(character => character.codePointAt(0)! < 128).join(""));
      });
    }
  }
}
