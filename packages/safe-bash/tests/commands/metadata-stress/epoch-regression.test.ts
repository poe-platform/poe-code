import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, oracleIdentity, run, sha256 } from "./helpers.js";

test("GNU stat exact millisecond epoch values do not lose a millisecond in scaling", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const real = await createRealFileSystem({ root });
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const failures: unknown[] = [];
  for (const milliseconds of [1001, 1003, 1005, 1007, 1011, 1013, 2002, 4004, 8008, 16016, 1234567890123]) {
    const seconds = milliseconds / 1000 + 0.0000005;
    await host.utimes(join(root, "work/file"), seconds, seconds);
    const measured = await real.stat("/work/file");
    assert.equal(measured.atimeMs, milliseconds);
    await memory.utimes("/work/file", measured.atimeMs, measured.mtimeMs);
    const native = oracle("stat", ["--printf=%X:%.1X:%.2X:%.3X", "file"], join(root, "work"));
    const actual = await run("stat", ["--printf=%X:%.1X:%.2X:%.3X", "file"], memory);
    assert.equal(native.exitCode, 0, native.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    if (!actual.stdout.equals(native.stdout)) failures.push({ milliseconds, measured: measured.atimeMs, native: native.stdout.toString(), virtual: actual.stdout.toString() });
  }
  assert.deepEqual(failures, []);
});

test("GNU 9.7 negative fractions retain runtime rounding for the existing nine timestamp rows", async context => {
  const identity = oracleIdentity("stat");
  assert.equal(await sha256(identity.path), identity.sha256);
  const root = await namespace(context);
  const sentinel = Uint8Array.of(83, 65, 70, 69, 0, 255);
  await host.writeFile(join(root, "sentinel"), sentinel);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const real = await createRealFileSystem({ root });
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const exactExpectations = new Map([
    [-999, "[-1][-1][-0.9][-0.99][-0.999]"],
    [-101, "[-1][-1][-0.1][-0.10][-0.101]"],
    [-11, "[-1][-1][-1.0][-0.01][-0.011]"],
    [-1, "[-1][-1][-1.0][-1.00][-0.001]"],
  ]);
  const failures: unknown[] = [];
  const format = "[%Y][%.0Y][%.1Y][%.2Y][%.3Y]";
  for (const requestedMs of [-16016, -4004, -2002, -1005, -1001, -999, -101, -11, -1]) {
    await host.utimes(join(root, "work/file"), new Date(requestedMs), new Date(requestedMs));
    const nativeStat = await host.stat(join(root, "work/file"), { bigint: true });
    const measured = await real.stat("/work/file");
    const mtimeMs = Number(nativeStat.mtimeNs) / 1_000_000;
    assert.equal(measured.mtimeMs, mtimeMs);
    await memory.utimes("/work/file", mtimeMs, mtimeMs);
    assert.equal((await memory.stat("/work/file")).mtimeMs, mtimeMs);
    const native = oracle("stat", [`--printf=${format}`, "file"], join(root, "work"));
    const actual = await run("stat", [`--printf=${format}`, "file"], memory);
    assert.equal(native.exitCode, 0, native.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    const calibration = { requestedMs, mtimeMs, mtimeNs: nativeStat.mtimeNs.toString(), remainderWithinMillisecondNs: (nativeStat.mtimeNs % 1_000_000n).toString(), native: native.stdout.toString(), actual: actual.stdout.toString() };
    context.diagnostic(JSON.stringify(calibration));
    if (!actual.stdout.equals(native.stdout)) failures.push(calibration);
    const exact = exactExpectations.get(requestedMs);
    if (exact !== undefined) {
      assert.equal(nativeStat.mtimeNs, BigInt(requestedMs) * 1_000_000n);
      assert.equal(native.stdout.toString(), exact);
    }
  }
  assert.deepEqual(await host.readFile(join(root, "sentinel")), Buffer.from(sentinel));
  assert.deepEqual(failures, []);
});

test("GNU 9.7 narrow widths retain trailing bytes for the existing sixteen timestamp rows", async context => {
  const identity = oracleIdentity("stat");
  assert.equal(await sha256(identity.path), identity.sha256);
  const root = await namespace(context);
  const sentinel = Uint8Array.of(83, 65, 70, 69, 0, 255);
  await host.writeFile(join(root, "sentinel"), sentinel);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const failures: unknown[] = [];
  const format = "[%1.3Y][%2.3Y][%3.3Y][%4.3Y]";
  for (const requestedMs of [-16016, -4004, -2002, -1005, -1001, -999, -101, -11, -1, 0, 1, 11, 999, 1001, 1005, 16016]) {
    await host.utimes(join(root, "work/file"), new Date(requestedMs), new Date(requestedMs));
    const nativeStat = await host.stat(join(root, "work/file"), { bigint: true });
    const mtimeMs = Number(nativeStat.mtimeNs) / 1_000_000;
    await memory.utimes("/work/file", mtimeMs, mtimeMs);
    assert.equal((await memory.stat("/work/file")).mtimeMs, mtimeMs);
    const native = oracle("stat", [`--printf=${format}`, "file"], join(root, "work"));
    const actual = await run("stat", [`--printf=${format}`, "file"], memory);
    assert.equal(native.exitCode, 0, native.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    const calibration = { requestedMs, mtimeMs, mtimeNs: nativeStat.mtimeNs.toString(), remainderWithinMillisecondNs: (nativeStat.mtimeNs % 1_000_000n).toString(), native: native.stdout.toString(), actual: actual.stdout.toString() };
    context.diagnostic(JSON.stringify(calibration));
    if (!actual.stdout.equals(native.stdout)) failures.push(calibration);
    if (requestedMs === 1) {
      assert.equal(nativeStat.mtimeNs, 1_000_000n);
      assert.equal(native.stdout.toString(), "[0.001][0.001][0.001  ][0.001 ]");
      const limited = await run("stat", ["--printf=%3.3Y", "file"], memory, { limits: { maxOutputBytes: 6 } });
      assert.equal(limited.exitCode, 1);
      assert.equal(limited.stdout.length, 0);
      assert.match(limited.stderr, /limit/u);
    }
  }
  assert.deepEqual(await host.readFile(join(root, "sentinel")), Buffer.from(sentinel));
  assert.deepEqual(failures, []);
});
