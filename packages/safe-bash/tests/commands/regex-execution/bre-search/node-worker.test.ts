import assert from "node:assert/strict";
import { after, test } from "node:test";
import { searchBre } from "../../../../src/commands/expr/bre-worker.js";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import { exprMatchCeilings, type BreSearchDescriptor, type ExprMatchLimits } from "../../../../src/commands/regex-execution/protocol.js";
import { nativeCases } from "./native.cases.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const descriptor = (pattern: string, limits: Partial<ExprMatchLimits> = {}): BreSearchDescriptor => ({ kind: "bre-search", pattern: bytes(pattern), profile: "byte", limits: { ...exprMatchCeilings, ...limits } });
const executor = new RegexExecutor({ maxWorkers: 1 });
const session = executor.open(new AbortController().signal);
after(async () => { await session.close(); await executor.dispose(); });

for (const [index, fixture] of nativeCases.entries()) {
  test(`actual Node BRE worker ${index + 1}: ${fixture.profile} ${JSON.stringify(fixture.pattern)} on ${JSON.stringify(fixture.subject)}`, async () => {
    const request = { kind: "bre-search" as const, pattern: Uint8Array.from(fixture.pattern), profile: fixture.profile, limits: exprMatchCeilings };
    if ("category" in fixture.expected) {
      await assert.rejects(session.searchBre(request, Uint8Array.from(fixture.subject)), { category: fixture.expected.category });
    } else {
      const result = await session.searchBre(request, Uint8Array.from(fixture.subject));
      assert.deepEqual(result.overall, fixture.expected.overall, fixture.native);
      assert.equal(result.matched, fixture.expected.overall !== null);
      assert.ok(result.steps > 0 && result.steps <= request.limits.maxSteps);
    }
  });
}

test("actual Node worker interleaves BRE search and unchanged expr exact-step replies", async () => {
  assert.deepEqual((await session.searchBre(descriptor("a"), bytes("ba"))).overall, { start: 1, end: 2 });
  const result = await session.matchExpr({ ...descriptor("a"), kind: "expr-match" }, bytes("abc"));
  assert.deepEqual(result, { offsetUnit: "byte", matched: true, hasCapture: false, overall: { start: 0, end: 1 }, capture: null, steps: 63 });
  assert.equal((await session.matchExpr({ ...descriptor("a"), kind: "expr-match" }, bytes("ba"))).matched, false);
  await assert.rejects(session.searchBre(descriptor("a["), bytes("")), { category: "syntax" });
  assert.deepEqual(await session.matchExpr({ ...descriptor("a"), kind: "expr-match" }, bytes("abc")), result);
});

test("actual Node BRE candidate budgets reject and allow subsequent request reuse", async () => {
  await assert.rejects(session.searchBre(descriptor("a", { maxStates: 64 }), bytes("b".repeat(64))), { category: "limit" });
  await assert.rejects(session.searchBre(descriptor("a\\|a\\|a", { maxStates: 2 }), bytes("a")), { category: "limit" });
  const compiled = await session.searchBre(descriptor("a"), bytes(""));
  await assert.rejects(session.searchBre(descriptor("a", { maxSteps: compiled.steps - 1 }), bytes("")), { category: "limit" });
  assert.deepEqual((await session.searchBre(descriptor("a"), bytes("ba"))).overall, { start: 1, end: 2 });
});

for (const reason of [false, 0, null, ""]) {
  test(`actual Node BRE abort retains ${JSON.stringify(reason)} and drains worker retirement`, async () => {
    const controller = new AbortController();
    const ownedExecutor = new RegexExecutor({ maxWorkers: 1 });
    const ownedSession = ownedExecutor.open(controller.signal);
    try {
      await ownedSession.searchBre(descriptor("a"), bytes("a"));
      const pending = ownedSession.searchBre(descriptor("\\(a\\|aa\\)*b"), bytes("a".repeat(128)));
      queueMicrotask(() => controller.abort(reason));
      await assert.rejects(pending, error => Object.is(error, reason));
      const closing = ownedSession.close();
      assert.equal(ownedSession.close(), closing);
      await closing;
    } finally { await ownedSession.close(); await ownedExecutor.dispose(); }
  });
}

test("actual Node BRE owns submitted bytes before transfer", async () => {
  const selected = descriptor("a"), subject = bytes("ba");
  const pending = session.searchBre(selected, subject);
  selected.pattern.fill(98); subject.fill(98);
  assert.deepEqual((await pending).overall, { start: 1, end: 2 });
});

test("Node BRE wrapper refuses main-thread execution", () => {
  assert.throws(() => searchBre(descriptor("a"), bytes("a")), /requires the regex worker/);
});
