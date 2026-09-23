import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMaxParseUnits, ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("parse admission is inclusive, cumulative, and terminal with one failure identity", () => {
  const failures: ShellLimitError[] = [];
  const budget = new ParseBudget(3, undefined, error => { failures.push(error); });
  budget.admit(2);
  budget.admit();
  assert.throws(() => budget.admit(), ShellLimitError);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.limit, "maxParseUnits");
  assert.throws(() => budget.admit(0), error => error === failures[0]);
  assert.equal(failures.length, 1);
  assert.equal(defaultMaxParseUnits, Infinity);
});

test("invalid limits and admissions fail before changing allowance", () => {
  for (const value of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new ParseBudget(value), RangeError);
    const budget = new ParseBudget(1);
    assert.throws(() => budget.admit(value), RangeError);
    budget.admit();
  }
});

test("already-observed cancellation retains identity before quota failure", () => {
  const reason = Object.freeze({ cancelled: true });
  const budget = new ParseBudget(0, AbortSignal.abort(reason), () => { assert.fail("must not replace cancellation"); });
  assert.throws(() => budget.admit(), error => error === reason);
});


test("omitted shell quotas stay unlimited when an individual limit is supplied", async () => {
  const { resolveLimits, Budget } = await import("../../src/shell/runtime.js");
  for (const [key, value] of Object.entries(resolveLimits({ maxOutputBytes: 7 }))) {
    assert.equal(value, key === "pipeHighWaterMark" ? 65536 : key === "maxOutputBytes" ? 7 : Infinity, key);
  }
  const budget = new ParseBudget();
  budget.admit(262145);
  const controller = new AbortController();
  const execution = new Budget(resolveLimits(), controller.signal);
  controller.abort("stop");
  assert.throws(() => execution.parsing.admit(), error => error === "stop");
  execution.close();
});

test("unconfigured shell accepts pipelines beyond the old default", async () => {
  const { Shell } = await import("../../src/shell/shell.js");
  const { MemoryFileSystem } = await import("@poe-code/safe-fs");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/script", new TextEncoder().encode(":"));
  const shell = new Shell({ fs });
  try {
    assert.equal((await shell.exec("sh /script; source /script")).exitCode, 0);
    const source = Array(65).fill(":").join(" | ");
    assert.equal((await shell.exec(source)).exitCode, 0);
    await assert.rejects(shell.exec(source, { limits: { maxPipelineStages: 64 } }), error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
    assert.equal((await shell.exec(source, { limits: { maxOutputBytes: 0 } })).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("arithmetic work has no fixed operation or acyclic variable-depth ceiling", async () => {
  const { prepareArithmetic, evaluateArithmetic } = await import("../../src/shell/arithmetic.js");
  assert.equal(evaluateArithmetic(prepareArithmetic(Array(5001).fill("1").join("+")), {}), 5001n);
  const variables: Record<string, string> = {};
  for (let i = 0; i < 100; i++) variables[`v${i}`] = i === 99 ? "1" : `v${i + 1}`;
  assert.equal(evaluateArithmetic(prepareArithmetic("v0"), variables), 1n);
});

test("job quotas are opt-in and accept limits above former defaults", async () => {
  const { createJobState } = await import("../../src/shell/extensions/jobs/state.js");
  for (const options of [{}, { maxJobs: 257 }, { maxWaiters: 65 }, { maxCleanupsPerJob: 65 }]) {
    const jobs = createJobState(options);
    for (let i = 0; i < 257; i++) await jobs.start(context => {
      for (let j = 0; j < 65; j++) context.registerCleanup(() => {});
      return { run: () => 0 };
    });
    await jobs.wait();
    let finish!: (status: number) => void;
    const running = new Promise<number>(resolve => { finish = resolve; });
    const handle = await jobs.start(() => ({ run: () => running }));
    const waits = Array.from({ length: 65 }, () => jobs.wait([{ handle }]));
    finish(0);
    assert.equal((await Promise.all(waits)).length, 65);
    await jobs.close();
  }
});


test("unlimited redirected input omits the filesystem read quota", async () => {
  const { MemoryFileSystem } = await import("@poe-code/safe-fs");
  const { fileInput } = await import("../../src/shell/input.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array([65]));
  Object.defineProperty(fs, "readStream", { value: undefined });
  const input = await fileInput(fs, "/input", Infinity, new AbortController().signal);
  const bytes: number[] = [];
  for await (const chunk of input) bytes.push(...chunk);
  assert.deepEqual(bytes, [65]);
});
