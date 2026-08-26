import assert from "node:assert/strict";
import test from "node:test";
import { verifyIndependentEdit } from "./edit-correctness.js";

test("independent edit verifier accepts either minimum repeated-line alignment", () => {
  for (const delta of ["1d0\n< same\n", "2d1\n< same\n"]) verifyIndependentEdit("same\nsame\n", "same\n", delta, "normal");
});

test("independent edit verifier rejects wrong bytes despite plausible ranges", () => {
  assert.throws(() => verifyIndependentEdit("old\n", "new\n", "1c1\n< wrong\n---\n> new\n", "normal"), /range\/body mismatch/u);
});

test("independent edit verifier rejects valid but nonminimal replacement", () => {
  assert.throws(() => verifyIndependentEdit("same\nold\n", "same\nnew\n", "1,2c1,2\n< same\n< old\n---\n> same\n> new\n", "normal"), /LCS minimum/u);
});

test("independent edit verifier rejects dropping a retained line", () => {
  assert.throws(() => verifyIndependentEdit("old\nkeep\n", "new\n", "1c1\n< old\n---\n> new\n", "normal"), /retained lines/u);
});

test("independent edit verifier checks unterminated context bytes", () => {
  verifyIndependentEdit("old", "new", "*** target\n--- target\n***************\n*** 1 ****\n! old\n\\ No newline at end of file\n--- 1 ----\n! new\n\\ No newline at end of file\n", "context");
});
