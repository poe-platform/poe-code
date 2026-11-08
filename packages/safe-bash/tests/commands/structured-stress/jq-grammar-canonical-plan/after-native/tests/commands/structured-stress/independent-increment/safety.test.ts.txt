import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { type ByteSource } from "../../../../src/contracts/index.js";
import { type JqLimits } from "../../../../src/commands/structured/index.js";
import { allVectors, executeBytes, expectedBytes } from "./harness.js";
import { nativeExpected } from "../jq-grammar-native-v3.js";

const reference = (id: string) => {
  const vector = allVectors.find(vector => vector.id === id);
  assert.ok(vector, id);
  return vector;
};

for (const id of ["unicode-records", "unicode-slurp", "json-multibyte", "json-surrogate-pair", "raw-nul"]) {
  test(`every split plus empty chunks preserves native bytes: ${id}`, { timeout: 3000 }, async () => {
    const vector = reference(id);
    const input = Buffer.from(vector.inputHex, "hex");
    for (let cut = 0; cut <= input.length; cut++) {
      async function* source() { yield input.subarray(0, cut); yield new Uint8Array(); yield input.subarray(cut); }
      assert.deepEqual(await executeBytes(vector.argv!, source()), expectedBytes(vector), `split ${cut}`);
    }
  });
}

test("UTF-8 crossing the internal 16384-byte scan boundary preserves native bytes", { timeout: 3000 }, async () => {
  const vector = reference("chunk-edge-reference");
  const input = Buffer.from(vector.inputHex, "hex");
  for (const cut of [16382, 16383, 16384, 16385, 16386, 16387]) {
    async function* source() { yield input.subarray(0, cut); yield new Uint8Array(); yield input.subarray(cut); }
    assert.deepEqual(await executeBytes(vector.argv!, source()), expectedBytes(vector), `split ${cut}`);
  }
});

for (const id of ["raw-lone-continuation", "raw-truncated", "raw-bad-continuation", "json-bad-string"]) {
  test(`native UTF-8 replacement remains chunk invariant: ${id}`, async () => {
    const vector = reference(id);
    const input = Buffer.from(vector.inputHex, "hex");
    const baseline = await executeBytes(vector.argv!, input);
    assert.deepEqual(baseline, nativeExpected(vector.argv!, input));
    for (let cut = 0; cut <= input.length; cut++) {
      async function* source() { yield input.subarray(0, cut); yield new Uint8Array(); yield input.subarray(cut); }
      assert.deepEqual(await executeBytes(vector.argv!, source()), baseline, `split ${cut}`);
    }
  });
}

for (const [id, limit, bytes] of [
  ["join-quota-prefix", "maxOutputBytes", 15],
  ["join-json-quota-reference", "maxOutputBytes", 8],
  ["join-unicode-separator", "maxOutputBytes", 8],
  ["raw-quota-reference", "maxOutputBytes", 4],
  ["raw-quota-reference", "maxValueBytes", 5],
] as const) {
  test(`exact ${limit} boundary retains native output: ${id}`, async () => {
    const vector = reference(id);
    const actual = await executeBytes(vector.argv!, Buffer.from(vector.inputHex, "hex"), { limits: { [limit]: bytes } });
    assert.deepEqual(actual, expectedBytes(vector));
    const short = await executeBytes(vector.argv!, Buffer.from(vector.inputHex, "hex"), { limits: { [limit]: bytes - 1 } });
    assert.equal(short.status, 5);
    assert.match(Buffer.from(short.stderrHex, "hex").toString(), new RegExp(limit));
    const native = Buffer.from(vector.expected.stdoutHex, "hex");
    const prefix = Buffer.from(short.stdoutHex, "hex");
    assert.deepEqual(prefix, native.subarray(0, prefix.length));
  });
}

const quotaCases: { name: keyof JqLimits; input: string; argv: string[]; value: number }[] = [
  { name: "maxInputBytes", input: `${"x".repeat(60)}\n`, argv: ["-Rj", "."], value: 50 },
  { name: "maxValueBytes", input: "x".repeat(20), argv: ["-Rj", "."], value: 12 },
  { name: "maxOutputBytes", input: '["雪","x"]', argv: ["-j", 'join("/")'], value: 4 },
  { name: "maxSourceBytes", input: "", argv: ["-nj", 'join("/")'], value: 4 },
  { name: "maxDepth", input: '[[["x"]]]', argv: ["-c", "."], value: 2 },
  { name: "maxAstDepth", input: "", argv: ["-nc", "[[[[1]]]]"], value: 2 },
  { name: "maxSteps", input: "", argv: ["-nc", "[range(1000)]?"], value: 40 },
  { name: "maxResults", input: '["雪","x"]', argv: ["-j", 'join(("/","|","!"))?'], value: 1 },
  { name: "maxCollectionSize", input: '["a","b","c","d"]', argv: ["-j", 'join("/")?'], value: 3 },
];
for (const fixture of quotaCases) test(`uncatchable quota: ${fixture.name}`, { timeout: 2500 }, async () => {
  const result = await executeBytes(fixture.argv, Buffer.from(fixture.input), { limits: { [fixture.name]: fixture.value } });
  assert.equal(result.status, 5);
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), new RegExp(fixture.name));
  if (fixture.name === "maxResults") assert.equal(result.stdoutHex, reference("join-quota-prefix").expected.stdoutHex.slice(0, 10));
  else assert.equal(result.stdoutHex, "");
});

test("raw backpressure precedes later generator error and cancels blocked write", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("independent write cancellation");
  let reads = 0;
  let cleanups = 0;
  let errors = 0;
  let entered!: () => void;
  let rejectLate!: (reason: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from("雪\nsecond\n") }; },
    async return() { cleanups++; return { done: true, value: undefined }; },
  }; } };
  const running = executeBytes(["-Rj", '[.]|join(("/",1/0))'], input, {}, {
    signal: controller.signal,
    stdout: { write(bytes) {
      assert.equal(Buffer.from(bytes).toString("hex"), reference("raw-quota-reference").expected.stdoutHex.slice(0, 6));
      entered();
      return new Promise<never>((_, reject) => { rejectLate = reject; });
    } },
    stderr: { async write() { errors++; } },
  });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  assert.equal(reads, 1);
  assert.equal(errors, 0);
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late sink failure"));
  await setImmediate();
  assert.equal(cleanups, 1);
  assert.equal(errors, 0);
});

test("partial multibyte input cancels pending read and observes late rejection", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("independent read cancellation");
  let reads = 0;
  let cleanups = 0;
  let entered!: () => void;
  let rejectLate!: (reason: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      if (++reads === 1) return Promise.resolve({ done: false as const, value: Buffer.from([0xf0, 0x9f]) });
      entered();
      return new Promise<IteratorResult<Uint8Array>>((_, reject) => { rejectLate = reject; });
    },
    async return() { cleanups++; return { done: true, value: undefined }; },
  }; } };
  const running = executeBytes(["-Rsj", "."], source, {}, { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late input failure"));
  await setImmediate();
  assert.equal(cleanups, 1);
});

test("cancellation interrupts separator generation before quota exhaustion", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  let writes = 0;
  const reason = new Error("independent CPU cancellation");
  const running = executeBytes(["-nj", '[],[]|join(range(1000000000))'], Buffer.alloc(0), { limits: { maxSteps: 100000000, maxResults: 10000000 } }, {
    signal: controller.signal,
    stdout: { async write() { if (++writes === 1) setTimeout(() => controller.abort(reason), 0); } },
  });
  await assert.rejects(running, error => error === reason);
  assert.ok(writes > 0 && writes < 10000000);
});

test("pre-aborted execution does not acquire input", async () => {
  let acquired = 0;
  const reason = new Error("already cancelled");
  const input: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected read"); } };
  await assert.rejects(executeBytes(["-Rj", "."], input, {}, { signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(acquired, 0);
});
