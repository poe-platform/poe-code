import assert from "node:assert/strict";
import test from "node:test";
import { ExprMatchError, RegexExecutionError, exprMatchCeilings, validateExprInput, validateExprReply, validateExprRequest, type ExprMatchDescriptor, type ExprMatchResult } from "../../../src/commands/regex-execution/protocol.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/client.js";

const signal = () => new AbortController().signal;
const descriptor: ExprMatchDescriptor = { kind: "expr-match", pattern: Buffer.from("\\(.\\)"), profile: "utf8-scalar", limits: exprMatchCeilings };
const subject = Buffer.from("😀x");
const result: ExprMatchResult = { offsetUnit: "byte", matched: true, hasCapture: true, overall: { start: 0, end: 4 }, capture: { start: 0, end: 4 }, steps: 123 };
const reply = { id: 1, operation: "expr-match", result };
const protocol = (error: unknown) => error instanceof RegexExecutionError && error.code === "PROTOCOL";

test("expr replies validate exact shape, original byte bounds and scalar boundaries", () => {
  assert.deepEqual(validateExprReply(reply, 1, descriptor, subject, signal()), result);
  const badResults: unknown[] = [null, [], {}, { ...result, extra: true }, { ...result, offsetUnit: "code-unit" },
    { ...result, offsetUnit: "scalar" }, { ...result, matched: 1 }, { ...result, hasCapture: "yes" },
    { ...result, steps: NaN }, { ...result, steps: 0 }, { ...result, steps: Infinity }, { ...result, steps: exprMatchCeilings.maxSteps + 1 },
    { ...result, matched: false }, { ...result, hasCapture: false }, { ...result, overall: null },
    ...[-1, 1.5, 6, NaN, Infinity].map(end => ({ ...result, overall: { start: 0, end } })),
    { ...result, overall: { start: 1, end: 4 } }, { ...result, overall: { start: 0, end: 2 } },
    { ...result, capture: { start: 4, end: 5 } }, { ...result, capture: { start: 3, end: 4 } },
    { ...result, capture: { start: 4, end: 0 } }, { ...result, capture: { start: 0, end: 4, scalar: 1 } },
  ];
  for (const bad of badResults) assert.throws(() => validateExprReply({ ...reply, result: bad }, 1, descriptor, subject, signal()), protocol, JSON.stringify(bad));
  for (const bad of [null, [], { ...reply, id: 2 }, { ...reply, operation: "grep" }, { ...reply, error: "x" }, { ...reply, extra: true },
    { id: 1, operation: "expr-match", error: "x", category: "wrong" },
    { id: 1, operation: "expr-match", error: "x".repeat(513), category: "syntax" },
    { id: 1, operation: "expr-match", error: 3, category: "syntax" }]) {
    assert.throws(() => validateExprReply(bad, 1, descriptor, subject, signal()), protocol);
  }
  const partial = { ...result, overall: { start: 0, end: 1 }, capture: { start: 0, end: 1 } };
  assert.deepEqual(validateExprReply({ ...reply, result: partial }, 1, { ...descriptor, profile: "byte" }, subject, signal()), partial);
  assert.throws(() => validateExprReply({ id: 1, operation: "expr-match", category: "syntax", error: "Trailing backslash" }, 1, descriptor, subject, signal()), error => error instanceof ExprMatchError && error.category === "syntax");
});

test("expr request shape, limits and admission validation are bounded", () => {
  const rows = [{ bytes: subject, all: false, terminated: false }];
  validateExprRequest({ id: 1, descriptor, rows });
  const invalid: unknown[] = [null, {}, { ...descriptor, extra: 1 }, { ...descriptor, kind: "grep" },
    { ...descriptor, pattern: "x" }, { ...descriptor, profile: "UTF16" }, { ...descriptor, limits: {} },
    { ...descriptor, limits: { ...exprMatchCeilings, extra: 1 } },
    ...[0, -1, NaN, Infinity, 0.5, exprMatchCeilings.maxDepth + 1].map(maxDepth => ({ ...descriptor, limits: { ...exprMatchCeilings, maxDepth } }))];
  for (const bad of invalid) assert.throws(() => validateExprInput(bad as ExprMatchDescriptor, rows, signal()), protocol);
  for (const bad of [undefined, [], [rows[0], rows[0]], [{ ...rows[0], all: true }], [{ ...rows[0], directory: false }], [{ ...rows[0], bytes: "x" }]]) {
    assert.throws(() => validateExprRequest({ id: 1, descriptor, rows: bad }), protocol);
  }
  for (const id of [0, -1, 0.5, NaN, Infinity, "1"]) assert.throws(() => validateExprRequest({ id, descriptor, rows }), protocol);
  assert.throws(() => validateExprRequest({ id: 1, descriptor, rows, extra: true }), protocol);
  assert.throws(() => validateExprInput({ ...descriptor, limits: { ...exprMatchCeilings, maxPatternBytes: 1 } }, rows, signal()), error => error instanceof ExprMatchError && error.category === "limit");
  assert.throws(() => validateExprInput({ ...descriptor, limits: { ...exprMatchCeilings, maxSubjectBytes: 1 } }, rows, signal()), error => error instanceof ExprMatchError && error.category === "limit");
  const reason = { why: "exact protocol abort" };
  const aborted = AbortSignal.abort(reason);
  assert.throws(() => validateExprReply(reply, 1, descriptor, subject, aborted), error => error === reason);
});

test("worker returns distinct absent, unmatched, empty and failed capture states", async () => {
  const executor = new RegexExecutor();
  const session = executor.open(signal());
  try {
    for (const [pattern, text, matched, hasCapture, overall, capture] of [
      ["a", "b", false, false, null, null],
      ["\\(a\\)", "b", false, true, null, null],
      ["\\(a\\)\\?b", "b", true, true, { start: 0, end: 1 }, null],
      ["\\(\\)", "b", true, true, { start: 0, end: 0 }, { start: 0, end: 0 }],
      ["[(]", "(", true, false, { start: 0, end: 1 }, null],
      ["\\(a\\)\\{0\\}", "b", true, true, { start: 0, end: 0 }, null],
      ["\\(.\\)", "😀x", true, true, { start: 0, end: 4 }, { start: 0, end: 4 }],
    ] as const) {
      const observed = await session.matchExpr({ ...descriptor, pattern: Buffer.from(pattern) }, Buffer.from(text));
      assert.deepEqual({ ...observed, steps: 0 }, { offsetUnit: "byte", matched, hasCapture, overall, capture, steps: 0 });
      assert.ok(observed.steps > 0);
    }
  } finally { await session.close(); }
});

test("the BRE compiler refuses main-thread execution", async () => {
  const { matchExpr } = await import("../../../src/commands/expr/bre-worker.js");
  assert.throws(() => matchExpr(descriptor, subject), /requires the regex worker/u);
});

test("expr longest matching does not change legacy ordered alternatives in the same worker", async () => {
  const executor = new RegexExecutor();
  const session = executor.open(signal());
  const grep = { kind: "grep", patterns: ["a|ab"], fixed: false, extended: true, insensitive: false, whole: false, word: false } as const;
  const row = { bytes: Buffer.from("ab"), all: false, terminated: true };
  try {
    assert.deepEqual(await session.run(grep, [row]), [[{ start: 0, end: 1 }]]);
    assert.deepEqual((await session.matchExpr({ ...descriptor, pattern: Buffer.from("a\\|ab") }, row.bytes)).overall, { start: 0, end: 2 });
    assert.deepEqual(await session.run(grep, [row]), [[{ start: 0, end: 1 }]]);
    assert.deepEqual(await session.run({ kind: "glob", patterns: ["*"], globOptions: [{ insensitive: false, literalUnclosedClass: false }] }, [row]), [[{ start: 0, end: 0 }]]);
    assert.equal((await session.matchExpr(descriptor, subject)).capture?.end, 4);
  } finally { await session.close(); }
});
