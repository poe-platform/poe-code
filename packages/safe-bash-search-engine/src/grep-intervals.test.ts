import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

const config = { kind: "grep", extended: true, fixed: false, caseMode: "sensitive", whole: false, word: false, nullData: false } as const;

for (const [pattern, translated, input, match] of [
  ['{"key"', '\\{"key"', '{"key": 1}', '{"key"'],
  ["a{", "a\\{", "a{", "a{"],
  ["a{,2}b", "a{0,2}b", "aab", "aab"],
  ["^a{,2}b$", "^a{0,2}b$", "aaab", undefined],
] as const) test(`grep interval translation and VM matching: ${pattern}`, () => {
  assert.deepEqual(prepareErgonomicRegex([pattern], config), { mode: "delegated", patterns: [translated], extended: true });
  const prepared = prepareErgonomicRegex([pattern], { ...config, forceVm: true });
  if (prepared.mode !== "vm") assert.fail("expected VM matcher");
  const found = prepared.vm.matchBytes(new TextEncoder().encode(input), false)[0];
  assert.equal(found ? input.slice(found.start, found.end) : undefined, match);
});

for (const pattern of ['{"key"', "a{", "a{,2}b"]) test(`rg retains strict interval syntax: ${pattern}`, () => {
  assert.throws(() => prepareErgonomicRegex([pattern], { ...config, kind: "rg" }));
});
