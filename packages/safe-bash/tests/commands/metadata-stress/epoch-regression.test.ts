import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

test("stat exact millisecond epoch values do not lose a millisecond in scaling", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  for (const milliseconds of [1001, 1003, 1005, 1007, 1011, 1013, 2002, 4004, 8008, 16016, 1234567890123]) {
    await memory.utimes("/work/file", milliseconds, milliseconds);
    assert.equal((await memory.stat("/work/file")).atimeMs, milliseconds);
    const actual = await run("stat", ["--printf=%X:%.1X:%.2X:%.3X", "file"], memory);
    assert.equal(actual.exitCode, 0, actual.stderr);
    const seconds = Math.floor(milliseconds / 1000);
    const fraction = (milliseconds % 1000).toString().padStart(3, "0");
    assert.equal(actual.stdout.toString(), `${seconds}:${seconds}.${fraction.slice(0, 1)}:${seconds}.${fraction.slice(0, 2)}:${seconds}.${fraction}`);
  }
});

test("stat negative fractions retain recorded rounding for nine timestamp rows", async () => {
  const memory = new MemoryFileSystem();
  const sentinel = Uint8Array.of(83, 65, 70, 69, 0, 255);
  await memory.writeFile("/sentinel", sentinel);
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const exactExpectations = new Map([
    [-999, "[-1][-1][-0.9][-0.99][-0.999]"],
    [-101, "[-1][-1][-0.1][-0.10][-0.101]"],
    [-11, "[-1][-1][-1.0][-0.01][-0.011]"],
    [-1, "[-1][-1][-1.0][-1.00][-0.001]"],
  ]);
  const format = "[%Y][%.0Y][%.1Y][%.2Y][%.3Y]";
  for (const requestedMs of [-16016, -4004, -2002, -1005, -1001, -999, -101, -11, -1]) {
    await memory.utimes("/work/file", requestedMs, requestedMs);
    assert.equal((await memory.stat("/work/file")).mtimeMs, requestedMs);
    const actual = await run("stat", [`--printf=${format}`, "file"], memory);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.ok(actual.stdout.toString().endsWith(`[${(requestedMs / 1000).toFixed(3)}]`));
    const exact = exactExpectations.get(requestedMs);
    if (exact !== undefined) assert.equal(actual.stdout.toString(), exact);
  }
  assert.deepEqual(await memory.readFile("/sentinel"), sentinel);
});

test("stat narrow widths retain recorded trailing bytes for sixteen timestamp rows", async () => {
  const memory = new MemoryFileSystem();
  const sentinel = Uint8Array.of(83, 65, 70, 69, 0, 255);
  await memory.writeFile("/sentinel", sentinel);
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const format = "[%1.3Y][%2.3Y][%3.3Y][%4.3Y]";
  for (const requestedMs of [-16016, -4004, -2002, -1005, -1001, -999, -101, -11, -1, 0, 1, 11, 999, 1001, 1005, 16016]) {
    await memory.utimes("/work/file", requestedMs, requestedMs);
    assert.equal((await memory.stat("/work/file")).mtimeMs, requestedMs);
    const actual = await run("stat", [`--printf=${format}`, "file"], memory);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout.toString().split("][").length, 4);
    if (requestedMs === 1) {
      assert.equal(actual.stdout.toString(), "[0.001][0.001][0.001  ][0.001 ]");
      const limited = await run("stat", ["--printf=%3.3Y", "file"], memory, { limits: { maxOutputBytes: 6 } });
      assert.equal(limited.exitCode, 1);
      assert.equal(limited.stdout.length, 0);
      assert.match(limited.stderr, /limit/u);
    }
  }
  assert.deepEqual(await memory.readFile("/sentinel"), sentinel);
});
