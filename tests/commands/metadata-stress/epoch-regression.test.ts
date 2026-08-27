import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run } from "./helpers.js";

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
