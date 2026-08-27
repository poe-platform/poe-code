import assert from "node:assert/strict";
import { after, test } from "node:test";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import { ExprMatchError, exprMatchCeilings, type ExprMatchLimits, type ExprMatchResult } from "../../../../src/commands/regex-execution/protocol.js";

const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
after(async () => { await session.close(); await executor.dispose(); });
const match = (subject: Uint8Array, pattern: string, profile: "byte" | "utf8-scalar" = "byte", limits: Partial<ExprMatchLimits> = {}) =>
  session.matchExpr({ kind: "expr-match", pattern: Buffer.from(pattern), profile, limits: { ...exprMatchCeilings, ...limits } }, subject);
const spans = (result: ExprMatchResult) => ({ matched: result.matched, overall: result.overall, capture: result.capture });

for (const [name, subject, pattern, expected] of [
  ["branch rollback does not leak inner participation", "aa", "\\(\\(a\\)b\\|a\\)\\2", { matched: false, overall: null, capture: null }],
  ["failed shorter alternative restores open outer capture", "abab", "\\(a\\|ab\\)\\1", { matched: true, overall: { start: 0, end: 4 }, capture: { start: 0, end: 2 } }],
  ["absent closed group is not completed empty", "", "\\(a\\)*\\1", { matched: false, overall: null, capture: null }],
  ["completed empty group can be referenced", "", "\\(a*\\)\\1", { matched: true, overall: { start: 0, end: 0 }, capture: { start: 0, end: 0 } }],
  ["reopened nonnullable capture closes at new position", "aaa", "\\(a\\)*\\1", { matched: true, overall: { start: 0, end: 3 }, capture: { start: 1, end: 2 } }],
  ["end anchor excludes final newline", "a\n", "\\(a\\)$", { matched: false, overall: null, capture: null }],
] as const) test(name, async () => {
  assert.deepEqual(spans(await match(Buffer.from(subject), pattern)), expected);
});

test("C byte capture preserves invalid UTF-8 without malformed wire intervals", async () => {
  assert.deepEqual(spans(await match(Uint8Array.of(255, 255, 255), "\\(.\\)*\\1")), {
    matched: true, overall: { start: 0, end: 3 }, capture: { start: 1, end: 2 },
  });
});

test("scalar repetition returns byte offsets, including supplementary characters", async () => {
  assert.deepEqual(spans(await match(Buffer.from("😀😀😀"), "\\(.\\)*\\1", "utf8-scalar")), {
    matched: true, overall: { start: 0, end: 12 }, capture: { start: 4, end: 8 },
  });
});

for (const [limit, value] of [["maxSteps", 1], ["maxAllocatedUnits", 1], ["maxNodes", 1], ["maxStates", 1]] as const) {
  test(`${limit} exhaustion rejects instead of returning partial best`, async () => {
    await assert.rejects(match(Buffer.from("aaaa"), "\\(a\\|aa\\)*", "byte", { [limit]: value }),
      error => error instanceof ExprMatchError && error.category === "limit");
    assert.equal((await match(Buffer.from("aa"), "\\(a\\)\\1")).matched, true);
  });
}
