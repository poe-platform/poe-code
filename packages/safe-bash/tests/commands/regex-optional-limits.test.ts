import { test } from "node:test";
import assert from "node:assert/strict";
import { policy, exprMatchCeilings, validateExprInput } from "../../src/commands/regex-execution/protocol.js";
import { EreLedger } from "../../src/commands/regex-execution/ere/limits.js";
import { Pattern } from "../../src/commands/text-programs/regex.js";
import { Budget } from "safe-bash-regex-engine/text/budget";
import type { CommandContext } from "../../src/contracts/index.js";

test("omitted worker quotas stay unlimited when one option is supplied", () => {
  for (const options of [{}, { maxWorkers: 3 }, { requestTimeoutMs: 50 }]) {
    const result = policy(options);
    assert.equal(result.maxQueuedBytes, Infinity);
    assert.equal(result.maxQueuedRequests, Infinity);
    assert.equal(result.workerOldGenerationMb, Infinity);
    if (!("requestTimeoutMs" in options)) assert.equal(result.requestTimeoutMs, Infinity);
  }
});
test("ERE limits are independent and can exceed former derived ceilings", () => {
  const ledger = new EreLedger({ maxExpansionBytes: 1, maxExpansionFields: 1 }, { work: 60_000_000 });
  assert.equal(ledger.limits.work, 60_000_000);
  assert.equal(ledger.limits.states, Infinity);
  assert.equal(ledger.limits.patternBytes, Infinity);
  ledger.charge("work", 60_000_000);
  assert.throws(() => ledger.charge("work", 1));
});
test("BRE protocol accepts unlimited and larger explicit individual limits", () => {
  const descriptor = { kind: "expr-match" as const, pattern: new Uint8Array([97]), profile: "byte" as const,
    limits: { ...exprMatchCeilings, maxSteps: 60_000_000 } };
  validateExprInput(descriptor, [{ bytes: new Uint8Array([97]), all: false, terminated: false }], new AbortController().signal);
});
test("text regex compilation admits former fixed boundaries through caller quotas", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  for (const source of [
    "a".repeat(8192), "a".repeat(8193),
    "(".repeat(64) + "a" + ")".repeat(64),
    "(".repeat(65) + "a" + ")".repeat(65),
    "a{16383}", "a{16384}"
  ]) {
    const pattern = new Pattern(source, true);
    await assert.rejects(pattern.prepare(new Budget(context, { maxSteps: 1 })), /execution step limit exceeded/);
    await assert.doesNotReject(pattern.prepare(new Budget(context, {})));
  }
  assert.throws(() => new Pattern("a{16384}", true, false, "sed", "", { maxPatternInstructions: 16384 }), /regular expression program limit exceeded/);
  assert.throws(() => new Pattern("a".repeat(8193), true, false, "sed", "", { maxPatternSource: 8192 }), /source limit exceeded/);
  assert.throws(() => new Pattern("(".repeat(65) + "a" + ")".repeat(65), true, false, "sed", "", { maxPatternDepth: 64 }), /depth limit exceeded/);
});

test("ERE compilation admits patterns beyond former grammar caps", async () => {
  const { compileEre } = await import("../../src/commands/regex-execution/ere/syntax.js");
  for (const pattern of ["a".repeat(5000), "(".repeat(70) + "a" + ")".repeat(70), "a{256}"]) {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    await compileEre(pattern, ledger);
  }
});
