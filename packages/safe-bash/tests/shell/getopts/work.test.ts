import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { createGetoptsState, GetoptsError, scanGetopts } from "../../../src/shell/getopts.js";
import type { GetoptsScanOptions, GetoptsWork } from "../../../src/shell/getopts.js";
import { options } from "./helpers.js";

test("UTF-8 bytes, argument count and steps accept exact bounds and refuse one less", async () => {
  const checkpoints: number[] = [];
  const limits = { maxArguments: 1, maxBytes: 3, maxSteps: 7, yieldEvery: 3, checkpoint: (steps: number) => { checkpoints.push(steps); } };
  const result = await scanGetopts(createGetoptsState(), "a", ["-a"], options(limits));
  assert.equal(result.option, "a");
  assert.deepEqual(checkpoints, [3, 3, 1]);
  for (const [override, code] of [[{ maxArguments: 0 }, "ARGUMENT_LIMIT"], [{ maxBytes: 2 }, "BYTE_LIMIT"], [{ maxSteps: 6 }, "STEP_LIMIT"]] as const) {
    await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], options({ ...limits, ...override })), { code });
  }
});

test("zero byte/argument limits can represent an empty scan, zero work cannot", async () => {
  const result = await scanGetopts(createGetoptsState(), "", [], options({ maxArguments: 0, maxBytes: 0, maxSteps: 2 }));
  assert.equal(result.kind, "end");
  await assert.rejects(scanGetopts(createGetoptsState(), "", [], options({ maxSteps: 0 })), { code: "STEP_LIMIT" });
});

for (const value of ["é", "🦊", "a🦊é", "\ud800", "\udc00", "\ud800x\udc00", "\ud800\ud800\udc00"]) {
  test(`byte budget follows UTF-8 replacement width: ${JSON.stringify(value)}`, async () => {
    const maxBytes = Buffer.byteLength("a:-a" + value);
    const result = await scanGetopts(createGetoptsState(), "a:", ["-a", value], options({ maxBytes }));
    assert.deepEqual(result.argument, { kind: "set", value });
    await assert.rejects(scanGetopts(createGetoptsState(), "a:", ["-a", value], options({ maxBytes: maxBytes - 1 })), { code: "BYTE_LIMIT" });
  });
}

test("argument limits reject long vectors before iteration or checkpoint admission", async () => {
  let calls = 0;
  await assert.rejects(scanGetopts(createGetoptsState(), "a", Array.from({ length: 4096 }, () => ""), options({ maxArguments: 16, checkpoint: () => { calls++; } })), { code: "ARGUMENT_LIMIT" });
  assert.equal(calls, 0);
});

test("empty arguments still consume bounded iteration work", async () => {
  const checkpoints: number[] = [];
  await assert.rejects(scanGetopts(createGetoptsState(), "", Array.from({ length: 1000 }, () => ""), options({ maxArguments: 1000, maxBytes: 0, maxSteps: 10, yieldEvery: 2, checkpoint: steps => { checkpoints.push(steps); } })), { code: "STEP_LIMIT" });
  assert.deepEqual(checkpoints, [2, 2, 2, 2, 2]);
});

test("long tokens stop within the byte cap instead of scanning the rest", async () => {
  let charged = 0;
  await assert.rejects(scanGetopts(createGetoptsState(), "a:", [`-a${"雪".repeat(100_000)}`], options({ maxBytes: 64, maxSteps: 100, yieldEvery: 4, checkpoint: steps => { charged += steps; } })), { code: "BYTE_LIMIT" });
  assert.ok(charged <= 32);
});

test("long specifications stop within the step cap", async () => {
  let charged = 0;
  await assert.rejects(scanGetopts(createGetoptsState(), "a".repeat(100_000), ["-a"], options({ maxBytes: 200_000, maxSteps: 32, yieldEvery: 8, checkpoint: steps => { charged += steps; } })), { code: "STEP_LIMIT" });
  assert.equal(charged, 32);
});

test("all supplied strings are bounded and validated before a successful transition", async () => {
  const state = Object.freeze({ index: 1, active: Object.freeze({ argument: 0, offset: 2 }) });
  await assert.rejects(scanGetopts(state, "ab", ["-ab", "late\0bad"], options()), { code: "INVALID_INPUT" });
  assert.deepEqual(state, { index: 1, active: { argument: 0, offset: 2 } });
});

for (const [spec, args] of [[null, []], ["a", null], ["a", "-a"], ["a", [1]], ["a", Array(2)], ["a\0", []], ["a", ["-a\0"]]] as const) {
  test(`malformed string/vector input is explicit: ${JSON.stringify([spec, args])}`, async () => {
    await assert.rejects(scanGetopts(createGetoptsState(), spec as string, args as unknown as string[], options()), { code: "INVALID_INPUT" });
  });
}

for (const field of ["maxArguments", "maxBytes", "maxSteps", "yieldEvery"] as const) {
  for (const value of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    test(`invalid work scalar ${field}=${value}`, async () => {
      await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], options({ [field]: value })), { code: "INVALID_INPUT" });
    });
  }
}

test("work controls and diagnostic policy have no implicit defaults", async () => {
  for (const invalid of [undefined, {}, { reportErrors: true }, { reportErrors: "0", work: options().work }, { reportErrors: true, work: { ...options().work, checkpoint: undefined } }, { reportErrors: true, work: { ...options().work, yieldEvery: 0 } }, { reportErrors: true, work: { ...options().work, signal: {} } }]) {
    await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], invalid as GetoptsScanOptions), { code: "INVALID_INPUT" });
  }
});

test("maximum safe work scalars do not overflow on small input", async () => {
  const result = await scanGetopts(createGetoptsState(), "a", ["-a"], options({ maxArguments: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER, maxSteps: Number.MAX_SAFE_INTEGER, yieldEvery: Number.MAX_SAFE_INTEGER }));
  assert.equal(result.option, "a");
});

test("pre-abort preserves an opaque errno-shaped reason without invoking a callback", async () => {
  const controller = new AbortController();
  const reason = { code: "ENOENT", task: "cancelled" };
  controller.abort(reason);
  let calls = 0;
  await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], options({ signal: controller.signal, checkpoint: () => { calls++; } })), error => error === reason);
  assert.equal(calls, 0);
});

test("final checkpoint abort cannot publish a transition", async () => {
  const controller = new AbortController();
  const reason = new Error("final checkpoint abort");
  const state = Object.freeze({ index: 1, active: Object.freeze({ argument: 0, offset: 2 }) });
  let calls = 0;
  await assert.rejects(scanGetopts(state, "ab", ["-ab"], options({ signal: controller.signal, yieldEvery: 100, checkpoint: () => { calls++; controller.abort(reason); } })), error => error === reason);
  assert.equal(calls, 1);
  assert.deepEqual(state, { index: 1, active: { argument: 0, offset: 2 } });
});

for (const asynchronous of [false, true]) {
  test(`checkpoint failure retains original identity (${asynchronous ? "async" : "sync"})`, async () => {
    const reason = { failure: "host steps exhausted" };
    const checkpoint: GetoptsWork["checkpoint"] = asynchronous ? async () => { throw reason; } : () => { throw reason; };
    await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], options({ yieldEvery: 1, checkpoint })), error => error === reason);
  });
}

test("abort settles while an admitted checkpoint is pending and observes its late rejection", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("abort pending hook");
  let rejectCheckpoint!: (reason: unknown) => void;
  const checkpointGate = new Promise<void>((_resolve, reject) => { rejectCheckpoint = reject; });
  const state = Object.freeze(createGetoptsState());
  let calls = 0;
  const scan = scanGetopts(state, "abc", ["-abc"], options({ signal: controller.signal, yieldEvery: 1, checkpoint: () => { calls++; return checkpointGate; } }));
  controller.abort(reason);
  await assert.rejects(scan, error => error === reason);
  rejectCheckpoint(new Error("late host failure"));
  await setImmediate();
  assert.equal(calls, 1);
  assert.deepEqual(state, { index: 0 });
});

test("abort followed by late checkpoint resolution cannot resume scanning", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let resolveCheckpoint!: () => void;
  const checkpointGate = new Promise<void>(resolve => { resolveCheckpoint = resolve; });
  let calls = 0;
  const args = Object.freeze(["-abc"]);
  const scan = scanGetopts(createGetoptsState(), "abc", args, options({ signal: controller.signal, yieldEvery: 1, checkpoint: () => { calls++; return checkpointGate; } }));
  controller.abort();
  await assert.rejects(scan, error => error === controller.signal.reason);
  resolveCheckpoint();
  await setImmediate();
  assert.equal(calls, 1);
  assert.deepEqual(args, ["-abc"]);
});

test("long validation provides explicit task-yield cancellation checkpoints", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("yielded cancellation");
  let charged = 0;
  const scan = scanGetopts(createGetoptsState(), "a".repeat(50_000), ["-a"], options({ signal: controller.signal, yieldEvery: 16, checkpoint: async steps => { charged += steps; await setImmediate(); } }));
  controller.abort(reason);
  await assert.rejects(scan, error => error === reason);
  await setImmediate();
  assert.equal(charged, 16);
});

test("silent and OPTERR decisions never require direct IO or alter the step contract", async () => {
  for (const reportErrors of [false, true]) for (const spec of ["a:", ":a:"]) {
    const result = await scanGetopts(createGetoptsState(), spec, ["-a"], options({}, reportErrors));
    assert.equal(result.kind, "missing-argument");
    assert.equal(result.status, 0);
    assert.equal(result.diagnostic !== null, reportErrors && !spec.startsWith(":"));
    assert.deepEqual(result.argument, spec.startsWith(":") ? { kind: "set", value: "a" } : { kind: "unset" });
  }
});

test("limit failures are typed without pretending to be utility exit statuses", async () => {
  await assert.rejects(scanGetopts(createGetoptsState(), "a", ["-a"], options({ maxBytes: 0 })), error => {
    assert.ok(error instanceof GetoptsError);
    assert.equal(error.name, "GetoptsError");
    assert.equal(error.code, "BYTE_LIMIT");
    assert.equal("status" in error, false);
    return true;
  });
});
