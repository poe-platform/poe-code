import { test } from "node:test";
import assert from "node:assert/strict";
import { policy, exprMatchCeilings, validateExprInput } from "../../src/commands/regex-execution/protocol.js";
import { EreLedger } from "../../src/commands/regex-execution/ere/limits.js";
import { Pattern } from "../../src/commands/text-programs/regex.js";

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
test("text regex compilation has no hidden nesting, repetition or program quotas", () => {
  assert.doesNotThrow(() => new Pattern("a".repeat(8193), true));
  assert.doesNotThrow(() => new Pattern("(".repeat(70) + "a" + ")".repeat(70), true));
  assert.doesNotThrow(() => new Pattern("a{17000}", true));
});

test("ERE compilation admits patterns beyond former grammar caps", async () => {
  const { compileEre } = await import("../../src/commands/regex-execution/ere/syntax.js");
  for (const pattern of ["a".repeat(5000), "(".repeat(70) + "a" + ")".repeat(70), "a{256}"]) {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    await compileEre(pattern, ledger);
  }
});
