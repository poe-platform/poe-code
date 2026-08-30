import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { run, Timers } from "./helpers.js";

for (const [args, milliseconds] of [
  [["0.0009999999", "0.0000000001"], 1], [["0.0004999999", "0.0005000001"], 1],
  [["0.0009999999", "0.0000000000999999999999"], 1],
  [["0.0009999999", "0.0000000001000000000001"], 2],
  [["0.001", "1e-1000000000000000000000"], 2], [["1e-1000000000000000000000"], 1],
  [[".000016666666666666m", ".00000000000000000004"], 1],
  [[".0000000001d", ".0000000001h", ".0000000001m", ".000990994"], 1],
  [["0.000000000000000000000000000001", "0.000999999999999999999999999999"], 1],
  [[".0005", ".0005", "1e-999999999999999999999"], 2],
  [["0e9999999999999999999999", "0e-9999999999999999999999"], 0],
] as const) {
  test(`sleep exact decimal carry ${JSON.stringify(args)}`, async () => {
    for (const operands of [args, [...args].reverse()]) {
      const scheduler = new Timers(), controller = new AbortController();
      const execution = run("sleep", operands, { scheduler }, { signal: controller.signal });
      assert.deepEqual(scheduler.scheduled, milliseconds ? [milliseconds] : []);
      scheduler.tick(milliseconds);
      const result = await execution;
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
      assert.equal(scheduler.pending.size, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
  });
}

test("sleep bounded exact rational properties across decimal positions and units", async () => {
  let state = 82371;
  for (let iteration = 0; iteration < 300; iteration++) {
    const operands: string[] = [];
    const denominator = 10n ** 80n;
    let numerator = 0n;
    for (let index = 0; index < 7; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const coefficient = BigInt(state % 100000 + 1), exponent = 8 + state % 70;
      const [unit, multiplier] = ([['s', 1n], ['m', 60n], ['h', 3600n], ['d', 86400n]] as const)[state % 4]!;
      operands.push(`${coefficient}e-${exponent}${unit}`);
      numerator += coefficient * multiplier * 1000n * 10n ** BigInt(80 - exponent);
    }
    const expected = Number((numerator + denominator - 1n) / denominator);
    const scheduler = new Timers();
    const execution = run("sleep", operands, { scheduler });
    assert.deepEqual(scheduler.scheduled, [expected], operands.join(" "));
    scheduler.tick(expected); assert.equal((await execution).exitCode, 0);
  }
});

test("sleep sparse decimal positions bound huge exponents without allocating exponent-sized buffers", async () => {
  const scheduler = new Timers();
  const args = [".000" + "9".repeat(18000), "1e-18003", "1e-" + "9".repeat(18000)];
  const execution = run("sleep", args, { scheduler });
  assert.deepEqual(scheduler.scheduled, [2]);
  scheduler.tick(2); assert.equal((await execution).exitCode, 0);
  const rejected = await run("sleep", ["1e" + "9".repeat(18000)], { scheduler });
  assert.equal(rejected.exitCode, 1); assert.deepEqual(scheduler.scheduled, [2]);
});

test("sleep exact range boundary preserves chunking and rejects excess before scheduling", async () => {
  for (const [operands, valid] of [
    [["9007199254740.991"], true], [["9007199254740.9909999999999", ".0000000000001"], true],
    [["9007199254740.991", "1e-9999999999999"], false],
    [["9007199254740.9909999999999", ".000000000000100000001"], false],
  ] as const) {
    const scheduler = new Timers(), controller = new AbortController(), reason = new Error("bounded range probe");
    const execution = run("sleep", operands, { scheduler }, { signal: controller.signal });
    if (valid) {
      assert.deepEqual(scheduler.scheduled, [2147483647]);
      controller.abort(reason); await assert.rejects(execution, error => error === reason);
    } else { assert.equal((await execution).exitCode, 1); assert.deepEqual(scheduler.scheduled, []); }
    assert.equal(scheduler.pending.size, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("sleep many fractional carries reach the boundary without per-operand rounding", async () => {
  const scheduler = new Timers();
  const execution = run("sleep", Array.from({ length: 4000 }, () => ".00000025"), { scheduler });
  assert.deepEqual(scheduler.scheduled, [1]); scheduler.tick(1);
  assert.equal((await execution).exitCode, 0); assert.equal(scheduler.pending.size, 0);
});
