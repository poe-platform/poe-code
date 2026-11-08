import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createMemoryFileSystem } from "../../../../src/index.ts";
import { streamCommands } from "../../../../src/commands/streams.ts";
import "./binding.mjs";

const root = new URL("../../../../", import.meta.url);
const previousCommit = "7a517cecab21d9fbff204df01a6a2ad2712a7673";
const previousManifest = JSON.parse(readFileSync(new URL("../fix/candidate-source.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("candidate-source.json", import.meta.url), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const previousSource = execFileSync("git", ["show", `${previousCommit}:src/commands/streams.ts`], { cwd: fileURLToPath(root), encoding: "utf8" });
assert.equal(sha256(previousSource), previousManifest.hashes["src/commands/streams.ts"]);
const rebound = previousSource
  .replace('from "../contracts/index.js"', `from ${JSON.stringify(new URL("src/contracts/index.ts", root).href)}`)
  .replace('from "./internal.js"', `from ${JSON.stringify(new URL("src/commands/internal.ts", root).href)}`);
const compiled = ts.transpileModule(rebound, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const previous = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const implementations = { previous: previous.streamCommands(), corrected: streamCommands() };
const NativeUint8Array = Uint8Array;
const fs = createMemoryFileSystem();
const signal = new AbortController().signal;
const controls = ["immutableBuffer", "immutableUint8Array", "reusedBuffer", "reusedUint8Array"];

function fixture(size, width, control, ragged = false) {
  const input = Buffer.alloc(size);
  for (let index = 0; index < size; index++) input[index] = index % 251 === 10 ? 11 : index % 251;
  input[size - 1] = 10;
  const storage = control.endsWith("Buffer") ? input : new NativeUint8Array(input);
  const reused = control.endsWith("Buffer") ? Buffer.alloc(width) : new NativeUint8Array(width);
  const sizes = ragged ? [width, ...Array(size - width).fill(1)]
    : Array.from({ length: Math.ceil(size / width) }, (_, index) => Math.min(width, size - index * width));
  return { input, sizes, async *source(checkpoint = () => {}) {
    let offset = 0;
    try {
      for (const length of sizes) {
        const expected = storage.subarray(offset, offset + length);
        const bytes = control.startsWith("reused") ? reused.subarray(0, length) : expected;
        if (control.startsWith("reused")) bytes.set(expected);
        yield bytes;
        assert.deepEqual(Buffer.from(bytes), input.subarray(offset, offset + length));
        checkpoint();
        offset += length;
      }
    } finally {
      if (control.startsWith("reused")) reused.fill(0);
    }
  } };
}

async function run(implementation, command, count, source) {
  const output = [];
  const result = await implementations[implementation].find(definition => definition.name === command).execute({
    command, args: ["-c", `${command === "head" ? "-" : ""}${count}`], cwd: "/", env: {}, fs, signal, stdin: source,
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { assert.fail(Buffer.from(bytes).toString()); } },
  });
  assert.equal(result.exitCode, 0);
  return Buffer.concat(output);
}

async function observe(implementation, command, count, data, expected) {
  let constructorBytes = 0;
  let sliceBytes = 0;
  let allocations = 0;
  let maxQueueBacking = 0;
  let maxQueueSlots = 0;
  let queue;
  const owned = new WeakSet();
  const nativeSlice = NativeUint8Array.prototype.slice;
  const nativePush = Array.prototype.push;
  globalThis.Uint8Array = new Proxy(NativeUint8Array, { construct(target, args) {
    const result = Reflect.construct(target, args);
    constructorBytes += result.byteLength;
    allocations++;
    owned.add(result);
    return result;
  } });
  NativeUint8Array.prototype.slice = function (start, end) {
    const result = nativeSlice.call(this, start, end);
    sliceBytes += result.byteLength;
    allocations++;
    return result;
  };
  Array.prototype.push = function (...items) {
    if (items.length === 1 && owned.has(items[0])) queue = this;
    return nativePush.apply(this, items);
  };
  try {
    const actual = await run(implementation, command, count, data.source(() => {
      const buffers = new Set(queue?.filter(Boolean).map(bytes => bytes.buffer));
      const bytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
      maxQueueBacking = Math.max(maxQueueBacking, bytes);
      maxQueueSlots = Math.max(maxQueueSlots, queue?.length ?? 0);
    }));
    assert.deepEqual(actual, expected);
  } finally {
    globalThis.Uint8Array = NativeUint8Array;
    NativeUint8Array.prototype.slice = nativeSlice;
    Array.prototype.push = nativePush;
  }
  assert.ok(queue);
  if (implementation === "corrected") {
    assert.ok(constructorBytes + sliceBytes <= 2 * data.input.length);
    assert.ok(allocations <= 2 * data.sizes.length);
    assert.ok(maxQueueBacking <= 2 * count);
  }
  return { constructorBytes, sliceBytes, allocations, maxQueueBacking, maxQueueSlots };
}

const started = new Date().toISOString();
const loadBefore = loadavg();
const memoryBefore = process.memoryUsage();
const cohorts = [];
for (const shape of [
  ...[65536, 262144, 1048576].flatMap(size => [1024, 65536].map(width => ({ size, width, count: 4096, ragged: false }))),
  { size: 65792, width: 65536, count: 65536, ragged: true },
]) {
  for (const control of controls) {
    for (const command of ["head", "tail"]) {
      const data = fixture(shape.size, shape.width, control, shape.ragged);
      const expected = command === "tail" ? data.input.subarray(-shape.count) : data.input.subarray(0, -shape.count);
      const allocation = {};
      for (const implementation of ["previous", "corrected"]) {
        allocation[implementation] = await observe(implementation, command, shape.count, data, expected);
        assert.deepEqual(await run(implementation, command, shape.count, data.source()), expected);
      }
      const samples = [];
      for (let repetition = 0; repetition < 6; repetition++) {
        const order = repetition % 2 ? ["corrected", "previous"] : ["previous", "corrected"];
        const elapsedMs = {};
        for (const implementation of order) {
          const before = performance.now();
          const actual = await run(implementation, command, shape.count, data.source());
          elapsedMs[implementation] = performance.now() - before;
          assert.deepEqual(actual, expected);
        }
        samples.push({ repetition, order, elapsedMs });
      }
      cohorts.push({ ...shape, control, command, inputHash: sha256(data.input), outputHash: sha256(expected), allocation, samples });
    }
  }
}
const results = {
  started, finished: new Date().toISOString(), codeCommit: manifest.codeCommit, previousCommit,
  sourceHashes: { previous: sha256(previousSource), corrected: manifest.hashes["src/commands/streams.ts"], internal: manifest.hashes["src/commands/internal.ts"] },
  node: process.version, platform: process.platform, arch: process.arch,
  tooling: { typescript: ts.version, tsx: JSON.parse(readFileSync(new URL("node_modules/tsx/package.json", root), "utf8")).version },
  loadBefore, loadAfter: loadavg(), memoryBefore, memoryAfter: process.memoryUsage(),
  cohortCount: cohorts.length, timedOutputs: cohorts.length * 12, warmupAndInstrumentedOutputs: cohorts.length * 4,
  qualifications: [
    "Previous means byte-correct ownership candidate 7a517cec, never buggy borrowed baseline.",
    "1024-byte tail/4096-count cohorts reuse previous author sizes, byte generation and work; 65536-byte cohorts add large chunks.",
    "Deterministic allocation observes Uint8Array constructors and slices; queue backing observes referenced array slots at source resumption, not GC/RSS/whole-process peak.",
    "Global instrumentation is restored before timing. Fixture allocation is outside timed region; byte mutation checks, output copies and final concatenation are equal work inside.",
    "Process memory includes both implementations, compiler/loader and fixtures; shared-host load and order/warmup effects prohibit performance guarantees.",
  ],
  cohorts,
};
if (process.argv.includes("--record")) writeFileSync(new URL("observations.json", import.meta.url), `${JSON.stringify(results, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ cohortCount: results.cohortCount, timedOutputs: results.timedOutputs, started, finished: results.finished, ragged: cohorts.filter(cohort => cohort.ragged).map(({ command, control, allocation }) => ({ command, control, allocation })) }, null, 2));
