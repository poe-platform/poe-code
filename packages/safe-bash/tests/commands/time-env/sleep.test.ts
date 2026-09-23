import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { run, Timers } from "./helpers.js";

for (const [args, duration] of [
  [["0.125"], 125], [[".001s", "0.002"], 3], [["1e-3m"], 60], [["+0.0001h"], 360],
  [["0.00001d"], 864], [["0.02"], 20], [["1.", "0.5s"], 1500],
  [["0x1p-10s"], 1], [["0X1P-4m"], 3750], [["0x.8p-8h"], 7032],
  [["0x1"], 1000], [["0x1.8p-2", ".125"], 500],
  [["0x1p-4", "0x1p-4"], 125], [[" \t\n\r\v\f+1e-3m"], 60],
  [["0X0P+4m", "0x0.00p-3h", " 0E-3m", "\t0.00h", " +0E0d"], 0],
  [["0x0p999999999999999999999", "0x1p-999999999999999999999"], 0],
] as const) {
  test(`sleep summed fractional intervals ${args.join(" ")}`, async () => {
    const scheduler = new Timers();
    const result = run("sleep", args, { scheduler });
    assert.deepEqual(scheduler.scheduled, duration ? [duration] : []);
    scheduler.tick(duration);
    assert.equal((await result).exitCode, 0); assert.equal(scheduler.pending.size, 0);
  });
}

test("sleep never finishes early and chunks intervals above timer range", async () => {
  const scheduler = new Timers();
  const result = run("sleep", ["2147483.65"], { scheduler });
  assert.deepEqual(scheduler.scheduled, [2147483647]);
  scheduler.tick(2147483646);
  assert.deepEqual(scheduler.scheduled, [2147483647, 4]);
  scheduler.tick(4);
  assert.equal((await result).exitCode, 0);
  assert.equal(scheduler.pending.size, 0);
});

test("sleep configurable timer quantum and submillisecond durations do not spin", async () => {
  const scheduler = new Timers();
  const result = run("sleep", [".0105"], { scheduler, maxTimerMilliseconds: 4 });
  scheduler.tick(4); scheduler.tick(4); scheduler.tick(3);
  assert.deepEqual(scheduler.scheduled, [4, 4, 3]);
  assert.equal((await result).exitCode, 0);
});

test("sleep abort before/during clears listeners and pending timers", async () => {
  for (const before of [true, false]) {
    const scheduler = new Timers(), controller = new AbortController(), reason = new Error("cancel exact");
    if (before) controller.abort(reason);
    const result = run("sleep", ["9000000d"], { scheduler }, { signal: controller.signal });
    if (!before) { assert.equal(scheduler.pending.size, 1); controller.abort(reason); }
    await assert.rejects(result, error => error === reason);
    assert.equal(scheduler.pending.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(scheduler.cleared.length, before ? 0 : 1);
  }
});

test("sleep handles abort synchronously triggered by a trusted scheduler setup without leaking its handle", async () => {
  const controller = new AbortController(), scheduler = new Timers();
  const original = scheduler.setTimeout.bind(scheduler);
  scheduler.setTimeout = (callback, delay) => { const handle = original(callback, delay); controller.abort("setup abort"); return handle; };
  await assert.rejects(run("sleep", ["1"], { scheduler }, { signal: controller.signal }), error => error === "setup abort");
  assert.equal(scheduler.pending.size, 0);
});

test("sleep rejects nonmonotonic scheduler time and cleans the subscription", async () => {
  const controller = new AbortController(), scheduler = new Timers();
  const result = run("sleep", ["1"], { scheduler }, { signal: controller.signal });
  scheduler.tick(-1);
  await assert.rejects(result, /monotonic/);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

for (const args of [[], ["-1"], ["1ms"], ["NaN"], ["Infinity"], ["1e999"], ["1", "bad"], ["1,2"], ["1D"], ["--invalid"], ["--", "0"], ["-0.00"],
  ["0x"], ["0x.p0"], ["0x1p"], ["0x1p+"], ["0x1p-1 "], ["0x1ps"], ["0x1g"], ["0x1P2S"], ["0 "], ["0\n"], ["0x0p0\n"], [""], [" "], ["\u00a00"], ["0x1p999999999999999999999"], ["0", "0x1p"]]) {
  test(`sleep validates all operands before waiting: ${JSON.stringify(args)}`, async () => {
    const scheduler = new Timers();
    const result = await run("sleep", args, { scheduler });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.notEqual(result.stderr, "");
    assert.deepEqual(scheduler.scheduled, []);
  });
}

test("sleep zero does not consume stdin or write either channel", async () => {
  const scheduler = new Timers();
  const fail = async () => { throw new Error("unexpected IO"); };
  const result = await run("sleep", ["0", "0d"], { scheduler }, {
    stdin: (async function* () { throw new Error("unexpected input"); })(), stdout: { write: fail }, stderr: { write: fail },
  });
  assert.equal(result.exitCode, 0); assert.deepEqual(scheduler.scheduled, []);
});

test("sleep default scheduler waits against monotonic elapsed time", async () => {
  const started = performance.now();
  const result = await run("sleep", [".015"]);
  assert.ok(performance.now() - started >= 15);
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
