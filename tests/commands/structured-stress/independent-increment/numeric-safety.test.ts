import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type ByteSource } from "../../../../src/contracts/index.js";
import { Budget, resolveJqLimits } from "../../../../src/commands/structured/limits.js";
import { parseJson, stringify } from "../../../../src/commands/structured/input.js";
import { allVectors, digest, executeBytes, expectedBytes } from "./harness.js";
import { additiveVectors } from "./phase2-harness.js";

test("phase-one product observations also remain byte-identical", () => {
  for (const [name, hash] of [
    ["phase1-observation.json", "b1553f455aedaf709384b5c76d7571bca18f6bcc7ecdb0b4d752d5d1be12a238"],
    ["supplement-observation.json", "8b1f9ea12ae069704dc54e9c6fc42c962e62883631c3056c2e3fae1be7ee449f"],
  ]) assert.equal(digest(readFileSync(new URL(name!, import.meta.url))), hash);
});
for (const [input, expected] of [["1e2", "1E+2"], ["12.3400", "12.3400"], ["9007199254740993", "9007199254740993"], ["0.0000001", "1E-7"]]) {
  test(`decimal byte budgets: ${input}`, async () => {
    const bytes = Buffer.from(input!);
    const size = Math.max(bytes.length, expected!.length);
    const accepted = await executeBytes(["-c", "."], bytes, { limits: { maxValueBytes: size, maxOutputBytes: expected!.length + 1 } });
    assert.equal(accepted.status, 0);
    assert.equal(Buffer.from(accepted.stdoutHex, "hex").toString(), `${expected}\n`);
    for (const limits of [{ maxValueBytes: size - 1 }, { maxOutputBytes: expected!.length }]) {
      const result = await executeBytes(["-c", ".?"], bytes, { limits });
      assert.equal(result.status, 5);
      assert.equal(result.stdoutHex, "");
      assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxValueBytes|maxOutputBytes/);
    }
  });
}
test("decimal metadata is scalar for depth and collection quotas", () => {
  const budget = new Budget(resolveJqLimits({ maxDepth: 1, maxCollectionSize: 1 }), new AbortController().signal);
  const value = parseJson("[12.3400]", budget);
  assert.equal(stringify(value, budget), "[12.3400]");
  assert.equal(budget.value(value), 9);
});
test("numeric generator results retain emitted prefix at the result quota", async () => {
  const reference = allVectors.find(vector => vector.id === "number-scale-identity")!;
  const result = await executeBytes(["-c", ".,."], Buffer.from(reference.inputHex, "hex"), { limits: { maxResults: 1 } });
  assert.equal(result.stdoutHex, reference.expected.stdoutHex);
  assert.equal(result.status, 5);
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxResults/);
});
test("numeric coefficients and comparisons charge the shared step budget", async () => {
  const coefficient = `1.${"2".repeat(4096)}`;
  for (const [argv, input] of [
    [["-c", ".?"], coefficient],
    [["-nc", `${JSON.stringify(coefficient)}|tonumber?`], ""],
    [["-nc", `any(range(10000);${coefficient} == ${coefficient} and empty)?`], ""],
  ] as const) {
    const result = await executeBytes(argv, Buffer.from(input), { limits: { maxSteps: 128 } });
    assert.equal(result.status, 5);
    assert.equal(result.stdoutHex, "");
    assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxSteps/);
  }
  const compared = await executeBytes(["-nc", `any(range(10000);${coefficient} == ${coefficient} and empty)?`], Buffer.alloc(0), { limits: { maxSteps: 1000 } });
  assert.equal(compared.status, 5);
  assert.match(Buffer.from(compared.stderrHex, "hex").toString(), /maxSteps/);
});
test("numeric join waits for its sink before evaluating a later error", async () => {
  const reference = allVectors.find(vector => vector.id === "number-scale-conversion")!;
  const controller = new AbortController();
  const reason = new Error("decimal sink cancellation");
  let entered!: () => void;
  let rejectLate!: (reason: Error) => void;
  let diagnostics = 0;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const running = executeBytes(["-j", '[.]|join(("|",1/0))'], Buffer.from(reference.inputHex, "hex"), {}, {
    signal: controller.signal,
    stdout: { write(bytes) {
      assert.equal(Buffer.from(bytes).toString(), "12.3400");
      entered();
      return new Promise<never>((_, reject) => { rejectLate = reject; });
    } },
    stderr: { async write() { diagnostics++; } },
  });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  assert.equal(diagnostics, 0);
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late decimal sink error"));
  await setImmediate();
  assert.equal(diagnostics, 0);
});
test("cancellation closes a stalled input in the middle of a numeric token", async () => {
  const controller = new AbortController();
  const reason = new Error("decimal read cancellation");
  let reads = 0;
  let closed = 0;
  let entered!: () => void;
  let rejectLate!: (reason: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      if (++reads === 1) return Promise.resolve({ done: false as const, value: Buffer.from("1.2300e-") });
      entered();
      return new Promise<IteratorResult<Uint8Array>>((_, reject) => { rejectLate = reject; });
    },
    async return() { closed++; return { done: true, value: undefined }; },
  }; } };
  const running = executeBytes(["-c", "."], input, {}, { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late decimal read error"));
  await setImmediate();
  assert.equal(closed, 1);
});
test("exponent magnitude does not allocate an expanded coefficient", async () => {
  const reference = additiveVectors.find(vector => vector.id === "exponent-bound-6")!;
  const result = await executeBytes(["-c", "."], Buffer.from(`1e${"9".repeat(16000)}`));
  assert.deepEqual(result, expectedBytes(reference));
});
for (const scenario of ["coefficient", "comparison", "cancel", "render-cancel"]) test(`bounded numeric subprocess: ${scenario}`, { timeout: 6000 }, () => {
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./numeric-worker.ts", import.meta.url)), scenario], { shell: false, timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ok\n");
});
