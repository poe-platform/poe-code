import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import * as nodeExecutor from "../../../src/commands/regex-execution/client.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { defaults, exprMatchCeilings, type GrepDescriptor } from "../../../src/commands/regex-execution/protocol.js";
import type { BoundedRegexProvider } from "../../../src/commands/regex-execution/provider.js";

const grep = (pattern: string): GrepDescriptor => ({
  kind: "grep", patterns: [pattern], fixed: false, extended: true, insensitive: false, whole: false, word: false,
});
const row = (text: string, all = false) => ({ bytes: new TextEncoder().encode(text), all, terminated: true });

test("host-only Node provider factory creates workers with the existing resource policy", async () => {
  assert.equal(typeof nodeExecutor.createNodeRegexProvider, "function");
  const provider: BoundedRegexProvider = nodeExecutor.createNodeRegexProvider();
  const worker = provider.createWorker({ ...defaults, workerOldGenerationMb: 64, workerStackMb: 2 });
  try {
    assert.ok(worker instanceof Worker);
    assert.ok(worker.resourceLimits);
    assert.equal(worker.resourceLimits.maxOldGenerationSizeMb, 64);
    assert.equal(worker.resourceLimits.stackSizeMb, 2);
  } finally { await worker.terminate(); }
});

test("injected Node provider preserves implicit Node native modes and expr matching", async () => {
  const options = { maxWorkers: 1, workerOldGenerationMb: 64, workerStackMb: 2 };
  const executors = [new nodeExecutor.RegexExecutor(options), new RegexExecutor(nodeExecutor.createNodeRegexProvider(), options)];
  try {
    assert.deepEqual(executors[0]!.options, executors[1]!.options);
    for (const executor of executors) {
      const session = executor.open(new AbortController().signal);
      try {
        assert.deepEqual(await session.run(grep("a|ab"), [row("ab")]), [[{ start: 0, end: 1 }]]);
        assert.deepEqual(await session.run({ ...grep("a"), insensitive: true, word: true }, [row("a aa A", true)]), [[{ start: 0, end: 1 }, { start: 5, end: 6 }]]);
        assert.deepEqual(await session.run({ kind: "rg", patterns: ["é+"], fixed: false, case: "insensitive", whole: false, word: false, nullData: false }, [row("ÉÉ_é", true)]), [[{ start: 0, end: 4 }, { start: 5, end: 7 }]]);
        const expression = await session.matchExpr({
          kind: "expr-match", pattern: new TextEncoder().encode("\\(a*\\)"), profile: "byte", limits: exprMatchCeilings,
        }, new TextEncoder().encode("aaa!"));
        assert.deepEqual({ ...expression, steps: undefined }, {
          offsetUnit: "byte", matched: true, hasCapture: true, overall: { start: 0, end: 3 }, capture: { start: 0, end: 3 }, steps: undefined,
        });
        assert.ok(expression.steps > 0 && expression.steps <= exprMatchCeilings.maxSteps);
      } finally { await session.close(); }
    }
  } finally { await Promise.all(executors.map(executor => executor.dispose())); }
});

test("injected Node provider retains native-regex deadline termination and caller-owned reuse", async () => {
  const provider = nodeExecutor.createNodeRegexProvider();
  const executor = new RegexExecutor(provider, { maxWorkers: 1, requestTimeoutMs: 25 });
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.run(grep("^(a+)+$"), [row("a".repeat(128) + "!")]), { code: "REQUEST_TIMEOUT" });
    assert.deepEqual(await session.run(grep("ok"), [row("ok")]), [[{ start: 0, end: 2 }]]);
  } finally {
    await session.close();
    await executor.dispose();
  }
  const reused = new RegexExecutor(provider);
  const next = reused.open(new AbortController().signal);
  try { assert.deepEqual(await next.run(grep("ok"), [row("ok")]), [[{ start: 0, end: 2 }]]); }
  finally { await next.close(); await reused.dispose(); }
});
