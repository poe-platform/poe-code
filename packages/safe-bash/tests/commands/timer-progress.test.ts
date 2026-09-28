import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createTimeEnvCommands } from "../../src/commands/time-env/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { createDeadline, defaultSchedulerBinding } from "../../src/commands/timeout/scheduler.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createCommandArguments } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import type { CommandContext } from "../../src/contracts/index.js";
function captureContext(args: readonly string[], additions: Partial<CommandContext> = {}) {
  const context: CommandContext = { command: "timeout", args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} }, stderr: { async write() {} }, ...additions };
  return { context };
}

function manualClock() {
  let now = 0;
  let callback: (() => void) | undefined;
  const steps: number[] = [];
  return {
    steps,
    now: () => now,
    setTimeout(fn: () => void, ms: number) { callback = fn; steps.push(ms); return fn; },
    clearTimeout() { callback = undefined; },
    fire(sample = now) { now = sample; const fn = callback; callback = undefined; assert.ok(fn); fn(); },
    get pending() { return callback !== undefined; },
  };
}

for (const samples of [[0, 0, 0], [1, 2, 3], [8, 8]] as const) {
  test(`sleep and timeout progress with clock samples ${samples}`, async () => {
    const scheduler = manualClock();
    const sleep = createTimeEnvCommands({ scheduler, maxTimerMilliseconds: 4 }).find(c => c.name === "sleep")!;
    const pending = sleep.execute(captureContext(["0.009"]).context);
    for (const sample of samples) scheduler.fire(sample);
    assert.equal(scheduler.pending, false);
    assert.equal((await pending).exitCode, 0);
    const timer = manualClock();
    const deadline = createDeadline({ receiver: timer, ...timer }, 9, 4);
    deadline.start();
    for (const sample of samples) timer.fire(sample);
    assert.equal(deadline.expired, true);
    assert.equal(deadline.signal.aborted, true);
    await deadline.retire();
  });
}

test("Infinity timer chunks are accepted and clamped to the host maximum", async () => {
  const scheduler = manualClock();
  const sleep = createTimeEnvCommands({ scheduler, maxTimerMilliseconds: Infinity }).find(c => c.name === "sleep")!;
  const controller = new AbortController();
  const pending = sleep.execute(captureContext(["2147484"], { signal: controller.signal }).context);
  assert.deepEqual(scheduler.steps, [2147483647]);
  controller.abort();
  await assert.rejects(Promise.resolve(pending));
  const timer = manualClock();
  const capture = captureContext(["2147484", "child"], { invoke: async () => ({ exitCode: 0 }) });
  await createTimeoutCommand({ scheduler: timer, maxTimerMilliseconds: Infinity }).execute(capture.context);
  assert.deepEqual(timer.steps, [2147483647]);
});

test("timeout binds host timers at use time and imports without performance", async () => {
  const bundled = await build({ entryPoints: ["src/commands/timeout/scheduler.ts"], absWorkingDir: new URL("../../", import.meta.url).pathname, bundle: true, write: false, platform: "neutral", format: "iife", globalName: "scheduler" });
  const host: Record<string, unknown> = {};
  runInNewContext(bundled.outputFiles[0]!.text, host);
  const binding = (host.scheduler as { defaultSchedulerBinding: typeof defaultSchedulerBinding }).defaultSchedulerBinding;
  host.performance = { now: () => 17 };
  host.setTimeout = (_fn: unknown, ms: number) => ms;
  let cleared: unknown;
  host.clearTimeout = (handle: unknown) => { cleared = handle; };
  assert.equal(binding.now(), 17);
  assert.equal(binding.setTimeout(() => {}, 9), 9);
  binding.clearTimeout(9);
  assert.equal(cleared, 9);
});

test("timeout validates and enforces argument and own-output limits before invocation", async () => {
  for (const limits of [{ maxArguments: 1 }, { maxArgumentBytes: 2 }, { maxOutputBytes: 1 }]) {
    const args = "maxOutputBytes" in limits ? ["--help"] : ["1", "child"];
    const capture = captureContext(args, { invoke: async () => assert.fail("limit admitted child") });
    await assert.rejects(async () => createTimeoutCommand({ limits }).execute(capture.context), /limit exceeded/);
  }
  assert.throws(() => createTimeoutCommand({ limits: { maxArguments: 0 } }), RangeError);
  assert.doesNotThrow(() => createTimeoutCommand({ limits: { maxArguments: Infinity } }));
});

test("timeout expires a cooperative child with a frozen host clock", async () => {
  const scheduler = manualClock();
  const capture = captureContext(["0.001", "child"], {
    invoke: async (_command, _args, options) => {
      scheduler.fire();
      options!.signal!.throwIfAborted();
      return { exitCode: 0 };
    },
  });
  assert.equal((await createTimeoutCommand({ scheduler }).execute(capture.context)).exitCode, 124);
  assert.equal(scheduler.pending, false);
});

test("invalid finite timer chunks remain rejected", () => {
  for (const maximum of [0, -1, 1.5, NaN, -Infinity, 2147483648]) {
    assert.throws(() => createTimeoutCommand({ maxTimerMilliseconds: maximum }), RangeError);
    assert.throws(() => createTimeEnvCommands({ maxTimerMilliseconds: maximum }), RangeError);
  }
});

test("timeout argument byte limits honor owned raw bytes", async () => {
  const argumentValues = createCommandArguments(["0", "child", shellValueFromBytes(Uint8Array.of(255))]);
  const capture = captureContext(argumentValues.args, { argumentValues, invoke: async () => ({ exitCode: 7 }) });
  assert.equal((await createTimeoutCommand({ limits: { maxArgumentBytes: 7 } }).execute(capture.context)).exitCode, 7);
  await assert.rejects(async () => createTimeoutCommand({ limits: { maxArgumentBytes: 6 } }).execute(capture.context), /limit exceeded/);
});
