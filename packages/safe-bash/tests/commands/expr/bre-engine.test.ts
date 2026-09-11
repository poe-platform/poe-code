import assert from "node:assert/strict";
import test from "node:test";
import { matchExprSteps } from "../../../src/commands/expr/bre-engine.js";
import { matchExpr } from "../../../src/commands/expr/bre-worker.js";
import { exprMatchCeilings, type ExprMatchDescriptor, type ExprMatchResult } from "../../../src/commands/regex-execution/protocol.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const descriptor = (pattern: string, profile: ExprMatchDescriptor["profile"] = "byte"): ExprMatchDescriptor => ({ kind: "expr-match", pattern: bytes(pattern), profile, limits: exprMatchCeilings });

function finish(execution: Generator<void, ExprMatchResult>): ExprMatchResult {
  let step = execution.next();
  while (!step.done) step = execution.next();
  return step.value;
}

test("neutral BRE engine preserves pre-factor Node results and exact work accounting", () => {
  for (const [pattern, subject, profile, steps, end, capture] of [
    ["a", "abc", "byte", 63, 1, null],
    ["a*", "aaa", "byte", 169, 3, null],
    ["\\(a*\\)a*", "aaa", "byte", 550, 3, { start: 0, end: 3 }],
    ["\\(ab\\)\\1", "abab", "byte", 193, 4, { start: 0, end: 2 }],
    ["[[:digit:]]\\{1,3\\}", "1234", "byte", 265, 3, null],
    ["\\(.\\)", "😀é", "utf8-scalar", 137, 4, { start: 0, end: 4 }],
  ] as const) {
    const selected = descriptor(pattern, profile);
    const result = finish(matchExprSteps(selected, bytes(subject)));
    assert.deepEqual(result, { offsetUnit: "byte", matched: true, hasCapture: capture !== null, overall: { start: 0, end }, capture, steps });
    assert.throws(() => finish(matchExprSteps({ ...selected, limits: { ...exprMatchCeilings, maxSteps: steps - 1 } }, bytes(subject))), { category: "limit" });
  }
});

test("neutral BRE preprocessing, compilation and matching expose resumable checkpoints", () => {
  for (const [pattern, subject] of [["a".repeat(256), ""], ["a\\{1024\\}", ""], ["a", "a".repeat(1024)], ["\\(a\\|aa\\)*b", "a".repeat(32)]]) {
    const execution = matchExprSteps(descriptor(pattern!), bytes(subject!));
    assert.equal(execution.next().done, false);
    assert.equal(execution.return(undefined as unknown as ExprMatchResult).done, true);
  }
});

test("Node BRE wrapper still rejects main-thread execution before engine admission", () => {
  assert.throws(() => matchExpr(descriptor("a"), bytes("a")), /requires the regex worker/);
});
