import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import type { CommandContext } from "safe-bash-contracts";
import { createGhInput } from "./input.js";
import { DEFAULT_GH_LIMITS } from "./types.js";

function context(fs: CommandContext["fs"], stdin = ""): CommandContext {
  return {
    command: "gh", args: [], cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: (async function* () { yield new TextEncoder().encode(stdin); })(),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
}

test("rejects oversized files before reading and retains swallowed budget failure", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/large", new TextEncoder().encode("12345"));
  fs.readFile = async () => assert.fail("oversized file was materialized");
  const input = createGhInput(context(fs), { ...DEFAULT_GH_LIMITS, maxInputBytes: 4 });
  await assert.rejects(input.fs.readFile("/large"), /input byte limit exceeded/u);
  assert.throws(input.assertWithinLimits, /input byte limit exceeded/u);
});

test("stdin is memoized and byte accounting includes repeated file reads", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("ab"));
  const input = createGhInput(context(fs, "cd"), { ...DEFAULT_GH_LIMITS, maxInputBytes: 4, maxFiles: 1 });
  assert.equal(new TextDecoder().decode(await input.readStdinBytes()), "cd");
  assert.equal(await input.readStdinBytes(), await input.readStdinBytes());
  await input.fs.readFile("/file");
  await assert.rejects(input.fs.readFile("/file"), /input byte limit exceeded/u);
});

test("missing optional files do not consume the file budget", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  const input = createGhInput(context(fs), { ...DEFAULT_GH_LIMITS, maxFiles: 1 });
  await assert.rejects(input.fs.readFile("/missing"));
  await input.fs.readFile("/file");
  input.assertWithinLimits();
});

test("Git worktree traversal shares input byte and file limits", async () => {
  const { readWorktreeFiles } = await import("./git-vfs.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/src", { recursive: true });
  await fs.writeFile("/repo/a", new TextEncoder().encode("ab"));
  await fs.writeFile("/repo/src/b", new TextEncoder().encode("cd"));
  for (const limits of [{ maxInputBytes: 3 }, { maxFiles: 1 }]) {
    const ctx = context(fs);
    const input = createGhInput(ctx, { ...DEFAULT_GH_LIMITS, ...limits });
    await assert.rejects(readWorktreeFiles(input.fs, "/repo", ctx.signal), /limit exceeded/u);
  }
});
