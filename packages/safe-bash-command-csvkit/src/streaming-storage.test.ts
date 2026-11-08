import { expect, test } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import type { FileSystem } from "safe-bash-contracts/filesystem";
import type { CsvkitContext } from "./contracts.js";
import { createReplayFile } from "./table/storage.js";
import { defaultLimits, run } from "./engine.js";
import { utf8Codec } from "./codecs/utf8.js";

function instrumentedStorage() {
  const backing = new MemoryFileSystem();
  const metrics = { bytesWritten: 0, largestWrite: 0, largestRead: 0, outstanding: 0, peakOutstanding: 0, live: 0, peakLive: 0 };
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("payload-wide readFile"); };
    if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
      const file = await backing.createStagedFile(...args);
      metrics.live++; metrics.peakLive = Math.max(metrics.peakLive, metrics.live);
      let removed = false;
      return { ...file, writer: {
        async write(bytes: Uint8Array, options: Parameters<NonNullable<typeof file.writer>["write"]>[1]) {
          metrics.bytesWritten += bytes.length;
          metrics.largestWrite = Math.max(metrics.largestWrite, bytes.length);
          metrics.outstanding += bytes.length;
          metrics.peakOutstanding = Math.max(metrics.peakOutstanding, metrics.outstanding);
          try { await Promise.resolve(); await file.writer!.write(bytes, options); }
          finally { metrics.outstanding -= bytes.length; }
        }, finish: file.writer!.finish.bind(file.writer)
      }, cleanup: {
        async remove() { await file.cleanup!.remove(); if (!removed) { removed = true; metrics.live--; } },
        close: file.cleanup!.close.bind(file.cleanup)
      } };
    };
    if (key === "openReadFile") return async (...args: Parameters<typeof backing.openReadFile>) => {
      const reader = await backing.openReadFile(...args);
      return { ...reader, async read(position: number, count: number, options: Parameters<typeof reader.read>[2]) {
        metrics.largestRead = Math.max(metrics.largestRead, count);
        return reader.read(position, count, options);
      } };
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  return { fs, backing, metrics };
}

function context(stdin: CsvkitContext["stdin"], stdout: CsvkitContext["stdout"], fs: FileSystem, signal: AbortSignal): CsvkitContext {
  return {
    argv: { length: 0, byteLength: 0, bytes: () => undefined! }, cwd: "/",
    fs: { readFile: async () => { throw new Error("payload read"); }, writeFile: async () => { throw new Error("payload write"); }, createReplayFile: options => createReplayFile(fs, "/", options.signal) },
    stdin, stdinIsDefault: false, stdout, stderr: { write: async bytes => { throw new Error(new TextDecoder().decode(bytes)); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [], locale: { profile: "C", timezone: "UTC", formatNumber: value => value },
    clock: { now: () => 0 }, limits: defaultLimits, signal, registerCleanup() {}
  };
}

test.each([800, 3200])("sort spills increasing inputs through bounded caller storage (%i rows)", async count => {
  const { fs, backing, metrics } = instrumentedStorage();
  const encoder = new TextEncoder();
  const source = { async *[Symbol.asyncIterator]() {
    yield encoder.encode("k,payload\n");
    const reused = new Uint8Array(106);
    for (let index = count - 1; index >= 0; index--) {
      reused.set(encoder.encode(String(index).padStart(4, "0") + "," + "x".repeat(100) + "\n"));
      yield reused;
    }
    reused.fill(0);
  } };
  let written = -1, active = 0, peak = 0;
  const stdout = { async write(bytes: Uint8Array) {
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(written < 0 ? "k,payload\n" : String(written).padStart(4, "0") + "," + "x".repeat(100) + "\n");
    written++; active--;
  } };
  expect(await run({ command: "csvsort", settings: { sniff_limit: count === 800 ? -1 : 0, no_inference: true, columns: "k" } }, context(source, stdout, fs, new AbortController().signal))).toBe(0);
  expect(written).toBe(count);
  expect(peak).toBe(1);
  // The mock backend stores data in RAM; account that separately, never as a
  // claim that its storage is a bounded external implementation.
  expect(metrics.bytesWritten).toBeGreaterThan(count * 100);
  expect(metrics.peakOutstanding).toBeLessThanOrEqual(16384);
  expect(metrics.largestRead).toBeLessThanOrEqual(16384);
  expect(metrics.largestWrite).toBeLessThanOrEqual(16384);
  expect(metrics.peakLive).toBeLessThanOrEqual(5);
  expect(metrics.live).toBe(0);
  expect(await backing.readdir("/")).toEqual([]);
});

test("sequential formatting stops pulling reused input while its sink is blocked", async () => {
  const { fs } = instrumentedStorage();
  let pulls = 0, finish!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const bytes = new TextEncoder().encode("a,b\n".repeat(2048));
  const source = { async *[Symbol.asyncIterator]() { for (let n = 0; n < 8; n++) { pulls++; yield bytes; } } };
  let writes = 0;
  const stdout = { async write() { if (++writes === 1) { entered(); await blocked; } } };
  const pending = run({ command: "csvformat", settings: {} }, context(source, stdout, fs, new AbortController().signal));
  await Promise.race([started, pending.then(() => { throw new Error("missing first write"); })]);
  const before = pulls;
  await Promise.resolve(); await Promise.resolve();
  expect(pulls).toBe(before);
  expect(pulls).toBeLessThan(8);
  finish();
  expect(await pending).toBe(0);
});

test("cancellation during output removes every spill and preserves the abort reason", async () => {
  const { fs, backing, metrics } = instrumentedStorage();
  const controller = new AbortController(), reason = new Error("cancel spilled sort");
  const encoder = new TextEncoder();
  const source = { async *[Symbol.asyncIterator]() {
    yield encoder.encode("k,payload\n");
    for (let n = 0; n < 900; n++) yield encoder.encode(`${n},${"x".repeat(100)}\n`);
  } };
  const stdout = { async write() { controller.abort(reason); } };
  await expect(run({ command: "csvsort", settings: { sniff_limit: 0, no_inference: true } }, context(source, stdout, fs, controller.signal))).rejects.toBe(reason);
  expect(metrics.bytesWritten).toBeGreaterThan(65536);
  expect(metrics.live).toBe(0);
  expect(await backing.readdir("/")).toEqual([]);
});

test("replay inference captures the clock after input consumption and preserves read-error precedence", async () => {
  const { fs } = instrumentedStorage();
  const encoder = new TextEncoder();
  let ended = false;
  const input = { async *[Symbol.asyncIterator]() { try { yield encoder.encode("n\n2\n"); } finally { ended = true; } } };
  const invocation = context(input, { async write() {} }, fs, new AbortController().signal);
  expect(await run({ command: "csvsort", settings: { sniff_limit: 0 } }, { ...invocation, clock: { now() { expect(ended).toBe(true); return 0; } } })).toBe(0);
  const failure = new Error("late source failure");
  const broken = { async *[Symbol.asyncIterator]() { yield encoder.encode("n\n2\n"); throw failure; } };
  await expect(run({ command: "csvsort", settings: { sniff_limit: 0, locale: "unsupported" } }, {
    ...context(broken, { async write() {} }, fs, new AbortController().signal), stderr: { async write() {} }
  })).rejects.toBe(failure);
});

test("join spills duplicate groups and restores left and right-match input order", async () => {
  const { fs, backing, metrics } = instrumentedStorage();
  const encoder = new TextEncoder(), count = 900;
  const input = (path: string) => ({ async *[Symbol.asyncIterator]() {
    if (path === "/a") { yield encoder.encode("k,a\nx,A0\nx,A1\ny,A2\n"); return; }
    expect(path).toBe("/b");
    yield encoder.encode("k,b\n");
    for (let n = count - 1; n >= 0; n--) yield encoder.encode(`x,${String(n).padStart(4, "0")}-${"x".repeat(100)}\n`);
  } });
  let written = -1;
  const invocation = context({ async *[Symbol.asyncIterator]() {} }, { async write(bytes) {
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(written < 0 ? "k,a,b\n" : written === count * 2 ? "y,A2,\n" :
      `x,A${Math.floor(written / count)},${String(count - 1 - written % count).padStart(4, "0")}-${"x".repeat(100)}\n`);
    written++; await Promise.resolve();
  } }, fs, new AbortController().signal);
  expect(await run({ command: "csvjoin", settings: { input_paths: ["a", "b"], columns: "k", left_join: true, sniff_limit: 0, no_inference: true } }, {
    ...invocation, fs: { ...invocation.fs, readStream: input }
  })).toBe(0);
  expect(written).toBe(count * 2 + 1);
  expect(metrics.bytesWritten).toBeGreaterThan(count * 100);
  expect(metrics.peakOutstanding).toBeLessThanOrEqual(16384);
  expect(metrics.peakLive).toBeLessThanOrEqual(8);
  expect(metrics.live).toBe(0);
  expect(await backing.readdir("/")).toEqual([]);
});
