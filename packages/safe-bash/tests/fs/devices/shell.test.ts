import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem } from "poe-code/safe-fs";
import { streamCommands } from "../../../src/commands/streams.js";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";
import { Shell } from "../../../src/shell/index.js";

const scripts = [
  "cat /dev/null",
  "head -c 37 /dev/zero",
  "head -c 37 < /dev/zero",
  "head -c 13 /dev/zero > /dev/null; head -c 17 /dev/zero",
  "head -c 13 /dev/zero >> /dev/null; head -c 17 /dev/zero",
  "head -c 13 /dev/zero > /dev/zero; head -c 17 /dev/zero",
  "cat /dev/zero | head -c 23",
];

for (const script of scripts) {
  test(`mounted device shell/native bytes: ${script}`, { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
    const native = execFileSync("/bin/bash", ["--noprofile", "--norc", "-c", script], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000, maxBuffer: 65536,
    });
    const shell = new Shell({
      fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } }),
      limits: { maxWallClockMs: 1000 },
    });
    for (const command of streamCommands()) shell.register(command);
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, new Uint8Array(native));
    } finally { await shell.dispose(); }
  });
}

test("mounted random streams return bytes through command and redirected input", async () => {
  const shell = new Shell({
    fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } }),
  });
  for (const command of streamCommands()) shell.register(command);
  try {
    for (const script of ["head -c 257 /dev/random", "head -c 257 < /dev/urandom"]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdoutBytes.byteLength, 257);
      assert.ok(result.stdoutBytes.some(byte => byte > 127));
    }
  } finally { await shell.dispose(); }
});
