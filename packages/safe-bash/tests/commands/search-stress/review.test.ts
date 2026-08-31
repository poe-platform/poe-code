import assert from "node:assert/strict";
import test from "node:test";
import { bounded, compare, native, text, virtual, virtualBatches, type Outcome, type Probe } from "./harness.js";

const probes: Probe[] = [
  { name: "directory negation does not rescue excluded children", args: ["--files", "."], files: { ".ignore": "*\n!src/\n", "src/a.txt": "foo\n" } },
  { name: "unclosed ignore bracket remains literal and retains later rules", args: ["--files", "."], files: { ".ignore": "[\n*.txt\n", "a.txt": "foo\n" } },
  { name: "nested repository resets parent VCS ignores", args: ["--files", "."], files: { ".gitignore": "*.txt\n", "nested/.git/config": "", "nested/a.txt": "foo\n" } },
  { name: "ignored followed cycle still reports native error", args: ["-L", "foo", "."], files: { ".ignore": "loop\n", "z.txt": "foo\n" }, links: { loop: "." } },
  { name: "before context stops binary no-match search", args: ["-C1", "foo", "-"], stdin: "no\0foo\n" },
  { name: "fragmented before context stops binary no-match search", args: ["-C1", "foo", "-"], stdin: "no\0foo\n", chunkSize: 1 },
  { name: "single-write binary warning after early match", args: ["foo", "-"], stdin: "foo\n\0\nno\n" },
  { name: "summary JSON member order after timing-only normalization", args: ["-a", "-F", "--json", "�", "-"], stdin: [255, 10] },
];
const actual = virtual(probes);
for (const [index, probe] of probes.entries()) test(`review ${probe.name}`, () => compare(actual[index]!, native(probe), probe));

test("back-to-back virtual chunks retain prior output, not a whole-write oracle", () => {
  const result = virtual([{ name: "fragmented binary", args: ["foo", "-"], stdin: "foo\n\0\nno\n", chunkSize: 1 }])[0]!;
  assert.equal(result.code, 0); assert.equal(text(result.stderr), "");
  assert.equal(text(result.stdout), 'foo\nbinary file matches (found "\\0" byte around offset 4)\n');
});

const captureLimit = 16 * 1024 * 1024;
const batchProbes = (count: number): Probe[] => Array.from({ length: count }, (_, index) => ({ name: `probe-${index}`, args: [String(index)] }));
const batchOutcomes = (batch: Probe[]): Outcome[] => batch.map(probe => ({ code: Number(probe.args[0]) % 3, stdout: Buffer.from(probe.name).toString("base64"), stderr: "" }));
const capturedBatch = (batch: Probe[]): Outcome => ({ code: 0, stdout: Buffer.from(JSON.stringify(batchOutcomes(batch))).toString("base64"), stderr: "" });

for (const count of [0, 64, 65, 486, 512]) test(`batch capture retains all ${count} outcomes in order`, () => {
  const input = batchProbes(count);
  const sizes: number[] = [];
  let remaining = captureLimit;
  const result = virtualBatches(input, (...parameters) => {
    assert.equal(parameters[0], process.execPath);
    assert.deepEqual(parameters[1].slice(0, 2), ["--import", "tsx"]);
    assert.ok(parameters[1][2]!.endsWith("/search-stress/worker.ts"));
    assert.ok(parameters[3].endsWith("/packages/safe-bash"));
    assert.equal(parameters[4], 10000);
    assert.equal(parameters[6], remaining);
    const batch = JSON.parse(String(parameters[2])) as Probe[];
    sizes.push(batch.length);
    const capture = capturedBatch(batch);
    remaining -= Buffer.from(capture.stdout, "base64").length;
    return capture;
  });
  assert.deepEqual(result, batchOutcomes(input));
  assert.deepEqual(sizes, Array.from({ length: Math.ceil(count / 64) }, (_, index) => Math.min(64, count - index * 64)));
});

test("batch capture rejects oversized input before any launch", () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(513), () => { launches++; return capturedBatch([]); }), /at most 8 batches/u);
  assert.equal(launches, 0);
});

for (const difference of [-1, 1]) test(`batch capture rejects cardinality difference ${difference} before another launch`, () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    launches++;
    const batch = JSON.parse(String(parameters[2])) as Probe[];
    return capturedBatch(launches === 2 ? batchProbes(batch.length + difference) : batch);
  }), /outcome count/u);
  assert.equal(launches, 2);
});

for (const reason of [undefined, null, false, 0, "", NaN, new Error("middle batch")]) test(`batch capture preserves middle rejection ${String(reason)}`, () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    if (++launches === 2) throw reason;
    return capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
  }), error => Object.is(error, reason));
  assert.equal(launches, 2);
});

test("batch capture preserves worker failure and stops before later batches", () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    if (++launches === 2) return { code: 77, stdout: "", stderr: Buffer.from("middle worker failure").toString("base64") };
    return capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
  }), /middle worker failure/u);
  assert.equal(launches, 2);
});

test("batch capture rejects malformed JSON without retry or later launches", () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    if (++launches === 2) return { code: 0, stdout: Buffer.from("{").toString("base64"), stderr: "" };
    return capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
  }), SyntaxError);
  assert.equal(launches, 2);
});

test("batch capture charges raw JSON whitespace and binary stderr before parsing", () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    launches++;
    if (launches === 2) {
      assert.equal(parameters[6], 16);
      return { code: 0, stdout: Buffer.alloc(17, 32).toString("base64"), stderr: "" };
    }
    const capture = capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
    const stdout = Buffer.from(capture.stdout, "base64");
    const stderr = Buffer.from([255, 195, 0]);
    capture.stdout = Buffer.concat([stdout, Buffer.alloc(captureLimit - 16 - stdout.length - stderr.length, 32)]).toString("base64");
    capture.stderr = stderr.toString("base64");
    return capture;
  }), /captured output exceeds/u);
  assert.equal(launches, 2);
});

for (const count of [64, 65]) test(`batch capture handles exact exhaustion with ${count} probes`, () => {
  let launches = 0;
  const run = () => virtualBatches(batchProbes(count), (...parameters) => {
    launches++;
    const capture = capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
    const stdout = Buffer.from(capture.stdout, "base64");
    capture.stdout = Buffer.concat([stdout, Buffer.alloc(captureLimit - stdout.length, 32)]).toString("base64");
    return capture;
  });
  if (count === 64) assert.deepEqual(run(), batchOutcomes(batchProbes(count)));
  else assert.throws(run, /captured output budget exhausted/u);
  assert.equal(launches, 1);
});

test("batch capture forwards remaining bytes to actual combined stdout/stderr capture", () => {
  let launches = 0;
  assert.throws(() => virtualBatches(batchProbes(129), (...parameters) => {
    launches++;
    if (launches === 2) {
      assert.equal(parameters[6], 1024);
      return bounded(process.execPath, ["--input-type=module", "-e", "process.stdout.write(Buffer.alloc(768)); process.stderr.write(Buffer.alloc(768));"], "", parameters[3], parameters[4], parameters[5], parameters[6]);
    }
    const capture = capturedBatch(JSON.parse(String(parameters[2])) as Probe[]);
    const stdout = Buffer.from(capture.stdout, "base64");
    capture.stdout = Buffer.concat([stdout, Buffer.alloc(captureLimit - 1024 - stdout.length, 32)]).toString("base64");
    return capture;
  }), error => error instanceof assert.AssertionError && (error.actual as NodeJS.ErrnoException)?.code === "ENOBUFS");
  assert.equal(launches, 2);
});

test("batch capture leaves the default single virtual invocation unchanged", () => {
  const input = batchProbes(65);
  let launches = 0;
  const result = virtual(input, undefined, (...parameters) => {
    launches++;
    assert.deepEqual(JSON.parse(String(parameters[2])), input);
    assert.equal(parameters[4], 10000);
    assert.equal(parameters[6], captureLimit);
    return capturedBatch(input);
  });
  assert.equal(launches, 1);
  assert.deepEqual(result, batchOutcomes(input));
});

test("batch capture rejects invalid or widened remaining limits before launch", () => {
  for (const remainingBytes of [captureLimit + 1, Infinity, 0.5, NaN]) {
    let launches = 0;
    assert.throws(() => virtual([], { remainingBytes }, () => { launches++; return capturedBatch([]); }), /invalid captured output budget/u);
    assert.equal(launches, 0);
    assert.throws(() => bounded("must-not-launch", [], "", process.cwd(), 10000, undefined, remainingBytes), /invalid captured output budget/u);
  }
});
