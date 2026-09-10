import assert from "node:assert/strict";
import test from "node:test";
import { searchBreSteps } from "../../../../src/commands/expr/bre-engine.js";
import { createBoundedRegexProvider } from "../../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../../src/commands/regex-execution/portable.js";
import { exprMatchCeilings, validateBreSearchInput, validateBreSearchReply, type BreSearchDescriptor, type BreSearchResult, type ExprMatchLimits } from "../../../../src/commands/regex-execution/protocol.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const descriptor = (pattern: string, limits: Partial<ExprMatchLimits> = {}): BreSearchDescriptor => ({ kind: "bre-search", pattern: bytes(pattern), profile: "byte", limits: { ...exprMatchCeilings, ...limits } });
function finish(execution: Generator<void, BreSearchResult>): BreSearchResult {
  let step = execution.next();
  while (!step.done) step = execution.next();
  return step.value;
}

test("candidate starts share work, state and allocation budgets", () => {
  const input = bytes("b".repeat(64));
  const baseline = finish(searchBreSteps(descriptor("a"), input));
  assert.equal(baseline.matched, false);
  assert.throws(() => finish(searchBreSteps(descriptor("a", { maxSteps: baseline.steps - 1 }), input)), { category: "limit" });
  assert.throws(() => finish(searchBreSteps(descriptor("a", { maxStates: 64 }), input)), { category: "limit" });
  assert.throws(() => finish(searchBreSteps(descriptor("a", { maxAllocatedUnits: 300 }), input)), { category: "limit" });
  assert.throws(() => finish(searchBreSteps(descriptor("a\\|a\\|a", { maxStates: 2 }), bytes("a"))), { category: "limit" });
});

test("input and compilation bounds apply before empty-subject matches", () => {
  for (const [pattern, input, limits] of [
    ["aa", "", { maxPatternBytes: 1 }], ["", "aa", { maxSubjectBytes: 1 }],
    ["a\\{32767\\}", "", { maxNodes: 128 }], ["\\(\\(a\\)\\)", "", { maxDepth: 1 }],
  ] as const) assert.throws(() => finish(searchBreSteps(descriptor(pattern, limits), bytes(input))), { category: "limit" });
});

test("queued byte ownership and fresh compilation survive request reuse", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    const selected = descriptor("a"), subject = bytes("ba");
    const pending = session.searchBre(selected, subject);
    selected.pattern[0] = 98; subject.fill(98);
    assert.deepEqual((await pending).overall, { start: 1, end: 2 });
    const first = await session.searchBre(descriptor("a"), bytes(""));
    const second = await session.searchBre(descriptor("a"), bytes(""));
    assert.equal(first.steps, second.steps);
    await assert.rejects(session.searchBre(descriptor("a", { maxSteps: first.steps - 1 }), bytes("")), { category: "limit" });
  } finally { await session.close(); await executor.dispose(); }
});

test("cooperative search cancellation retains falsey reasons and drains close", async () => {
  for (const reason of [false, 0, null, ""]) {
    const controller = new AbortController();
    const executor = new RegexExecutor(createBoundedRegexProvider());
    const session = executor.open(controller.signal);
    try {
      const pending = session.searchBre(descriptor("\\(a\\|aa\\)*b"), bytes("a".repeat(128)));
      queueMicrotask(() => controller.abort(reason));
      await assert.rejects(pending, error => Object.is(error, reason));
      const closing = session.close();
      assert.equal(session.close(), closing);
      await closing;
    } finally { await session.close(); await executor.dispose(); }
  }
});

test("BRE protocol rejects data accessors and symbol fields before evaluating them", () => {
  let invoked = 0;
  const selected = Object.defineProperty({ ...descriptor("a") }, "kind", { enumerable: true, get() { invoked++; return "bre-search"; } });
  const rows = [{ bytes: bytes("a"), all: false, terminated: false }];
  const signal = new AbortController().signal;
  assert.throws(() => validateBreSearchInput(selected, rows, signal), { code: "PROTOCOL" });
  assert.equal(invoked, 0);
  const extra = { ...descriptor("a"), [Symbol("extra")]: true };
  assert.throws(() => validateBreSearchInput(extra, rows, signal), { code: "PROTOCOL" });
  const result = Object.defineProperty({ offsetUnit: "byte", matched: true, overall: null, steps: 1 }, "overall", { enumerable: true, get() { invoked++; return { start: 0, end: 1 }; } });
  assert.throws(() => validateBreSearchReply({ id: 1, operation: "bre-search", result }, 1, descriptor("a"), bytes("a"), signal), { code: "PROTOCOL" });
  assert.equal(invoked, 0);
});

test("BRE replies retain original byte boundaries including malformed byte literals", () => {
  const signal = new AbortController().signal;
  const selected = { ...descriptor("."), profile: "utf8-scalar" as const };
  const reply = (start: number, end: number) => ({ id: 1, operation: "bre-search", result: { offsetUnit: "byte", matched: true, overall: { start, end }, steps: 1 } });
  assert.throws(() => validateBreSearchReply(reply(1, 2), 1, selected, bytes("é"), signal), { code: "PROTOCOL" });
  assert.throws(() => validateBreSearchReply(reply(0, 1), 1, selected, bytes("é"), signal), { code: "PROTOCOL" });
  assert.deepEqual(validateBreSearchReply(reply(1, 2), 1, selected, Uint8Array.of(255, 128), signal).overall, { start: 1, end: 2 });
  assert.throws(() => validateBreSearchReply({ ...reply(0, 1), operation: "expr-match" }, 1, selected, bytes("a"), signal), { code: "PROTOCOL" });
});
