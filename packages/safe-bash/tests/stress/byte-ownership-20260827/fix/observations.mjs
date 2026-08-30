import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { collect, lines } from "../../../../src/commands/internal.ts";
import { streamCommands } from "../../../../src/commands/streams.ts";
import { createMemoryFileSystem } from "../../../../src/index.ts";

const before = JSON.parse(readFileSync(new URL("source-before.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const contracts = new URL("../../../../src/contracts/index.ts", import.meta.url).href;
function baselineModule(path, internal) {
  const source = execFileSync("git", ["show", `${before.head}:${path}`], { encoding: "utf8" });
  assert.equal(hash(source), before.hashes[path]);
  const bound = source.replace('"../contracts/index.js"', JSON.stringify(contracts))
    .replace('"./internal.js"', JSON.stringify(internal ?? "unused"));
  const compiled = ts.transpileModule(bound, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const baselineInternalURL = baselineModule("src/commands/internal.ts");
const baselineInternal = await import(baselineInternalURL);
const baselineStreams = await import(baselineModule("src/commands/streams.ts", baselineInternalURL));
const implementations = {
  baseline: { ...baselineInternal, tail: baselineStreams.streamCommands().find(command => command.name === "tail") },
  candidate: { collect, lines, tail: streamCommands().find(command => command.name === "tail") },
};
const NativeUint8Array = Uint8Array;
const signal = new AbortController().signal;
const fs = createMemoryFileSystem();
const width = 1024;
const tailBytes = 4096;
function fixture(size, control) {
  const input = Buffer.alloc(size);
  for (let index = 0; index < size; index++) input[index] = index % 251 === 10 ? 11 : index % 251;
  input[size - 1] = 10;
  const owned = new NativeUint8Array(input);
  const reused = new NativeUint8Array(width);
  return {
    input,
    async *source() {
      for (let offset = 0; offset < size; offset += width) {
        if (control === "immutableBuffer") yield input.subarray(offset, offset + width);
        else if (control === "ownedUint8Array") yield owned.subarray(offset, offset + width);
        else {
          reused.set(input.subarray(offset, offset + width));
          yield reused;
        }
      }
      if (control === "reusedUint8Array") reused.fill(0);
    },
  };
}
async function run(site, implementation, source, count = tailBytes) {
  if (site === "collect") return implementation.collect(source, signal);
  if (site === "lines") {
    const records = [];
    for await (const line of implementation.lines(source)) records.push(line);
    assert.equal(records.length, 1);
    assert.equal(records[0].terminated, true);
    return records[0].bytes;
  }
  const output = [];
  const result = await implementation.tail.execute({
    command: "tail", args: ["-c", String(count)], cwd: "/", env: {}, fs, signal, stdin: source,
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { assert.fail(Buffer.from(bytes).toString()); } },
  });
  assert.equal(result.exitCode, 0);
  return Buffer.concat(output);
}
function expected(site, input) {
  return site === "collect" ? input : site === "lines" ? input.subarray(0, -1) : input.subarray(-tailBytes);
}
const allocation = [];
for (const size of [64 * 1024, 256 * 1024, 1024 * 1024]) {
  for (const site of ["collect", "lines", "tail"]) {
    const data = fixture(size, "immutableBuffer");
    const copied = [];
    const allocations = [];
    globalThis.Uint8Array = new Proxy(NativeUint8Array, {
      construct(target, args) {
        if (args[0] instanceof NativeUint8Array) copied.push(args[0].byteLength);
        else if (typeof args[0] === "number") allocations.push(args[0]);
        return Reflect.construct(target, args);
      },
    });
    let result;
    try { result = await run(site, implementations.candidate, data.source()); }
    finally { globalThis.Uint8Array = NativeUint8Array; }
    assert.deepEqual(Buffer.from(result), expected(site, data.input));
    const retainedBytes = copied.reduce((total, count) => total + count, 0);
    assert.equal(retainedBytes, site === "lines" ? size - width : size);
    assert.equal(copied.length, site === "lines" ? size / width - 1 : size / width);
    allocation.push({ size, site, retainedConstructorCalls: copied.length, retainedBytes, numericAllocations: allocations });
  }
}
const started = new Date().toISOString();
const hostLoadBefore = loadavg();
const memoryBefore = process.memoryUsage();
const raggedTail = [];
for (const control of ["ownedUint8Array", "immutableBuffer"]) {
  const count = 64 * 1024;
  const extra = 256;
  const data = fixture(count + extra, "immutableBuffer").input;
  const storage = control === "immutableBuffer" ? data : new NativeUint8Array(data);
  async function* source() {
    yield storage.subarray(0, count);
    for (let offset = count; offset < storage.length; offset++) yield storage.subarray(offset, offset + 1);
  }
  const measurements = {};
  for (const [name, implementation] of Object.entries(implementations)) {
    let retainedConstructorBytes = 0;
    let retainedSliceBytes = 0;
    let partialSliceBytes = 0;
    const nativeSlice = NativeUint8Array.prototype.slice;
    NativeUint8Array.prototype.slice = function (start, end) {
      const result = nativeSlice.call(this, start, end);
      if (start === undefined) retainedSliceBytes += result.byteLength;
      else partialSliceBytes += result.byteLength;
      return result;
    };
    globalThis.Uint8Array = new Proxy(NativeUint8Array, {
      construct(target, args) {
        if (args[0] instanceof NativeUint8Array) retainedConstructorBytes += args[0].byteLength;
        return Reflect.construct(target, args);
      },
    });
    let result;
    try { result = await run("tail", implementation, source(), count); }
    finally {
      globalThis.Uint8Array = NativeUint8Array;
      NativeUint8Array.prototype.slice = nativeSlice;
    }
    assert.deepEqual(Buffer.from(result), data.subarray(-count));
    measurements[name] = { retainedConstructorBytes, retainedSliceBytes, partialSliceBytes, milliseconds: [] };
  }
  const order = [];
  for (let round = 0; round < 6; round++) {
    const names = round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    order.push(names);
    for (const name of names) {
      globalThis.gc?.();
      const start = performance.now();
      const result = await run("tail", implementations[name], source(), count);
      measurements[name].milliseconds.push(performance.now() - start);
      assert.deepEqual(Buffer.from(result), data.subarray(-count));
    }
  }
  raggedTail.push({ control, firstChunkBytes: count, followingOneByteChunks: extra, outputSha256: hash(data.subarray(-count)), order, measurements });
}
const timings = [];
for (const size of [64 * 1024, 256 * 1024, 1024 * 1024]) {
  for (const site of ["collect", "lines", "tail"]) {
    for (const control of ["ownedUint8Array", "immutableBuffer", "reusedUint8Array"]) {
      const data = fixture(size, control);
      for (const implementation of Object.values(implementations)) {
        assert.deepEqual(Buffer.from(await run(site, implementation, data.source())), expected(site, data.input));
      }
      const samples = { baseline: [], candidate: [] };
      const order = [];
      for (let round = 0; round < 6; round++) {
        const names = round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
        order.push(names);
        for (const name of names) {
          globalThis.gc?.();
          const start = performance.now();
          const result = await run(site, implementations[name], data.source());
          samples[name].push(performance.now() - start);
          assert.deepEqual(Buffer.from(result), expected(site, data.input));
        }
      }
      timings.push({ size, site, control, inputSha256: hash(data.input), outputSha256: hash(expected(site, data.input)), order, milliseconds: samples });
    }
  }
}
console.log(JSON.stringify({
  started, finished: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  baselineHead: before.head,
  baselineSourceHashes: Object.fromEntries(["src/commands/internal.ts", "src/commands/streams.ts"].map(path => [path, before.hashes[path]])),
  candidateSourceHashes: Object.fromEntries(["src/commands/internal.ts", "src/commands/streams.ts"].map(path => [path, hash(readFileSync(path))])),
  binding: "Baseline exact git blobs hash-checked, transpiled in memory with installed TypeScript; only import specifiers rebound to current contracts and baseline helper. Candidate direct inspected TS imports via tsx. No shared dist or source writes.",
  limits: "Input at most 1MiB, chunk width 1024, tail 4096; below existing 32MiB byte limits. No borrowed Buffer baseline timing comparator. Allocation instrumentation only outside timed runs.",
  caveats: "Shared host; sequential paired alternating order, six repeats, one warmup per implementation; fixture iteration and byte sink collection included equally. GC before samples, no speedup or peak-memory claim; process memory snapshots include loader/compiler/both implementations and are not per-candidate memory comparisons. Existing tail trimming/queue behavior is unchanged; this measures retained constructors and aligned chunks, not a global tail complexity bound.",
  hostLoadBefore, hostLoadAfter: loadavg(), memoryBefore, memoryAfter: process.memoryUsage(), allocation, raggedTail, timings,
}, null, 2));
