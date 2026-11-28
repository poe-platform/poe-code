import { createMemoryFileSystem } from "@poe-code/safe-fs";
import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createStdbufCommand } from "./index.js";

test("argument limit is checked before invoking a command", async () => {
  let invoked = false;
  const context: CommandContext = {
    command: "stdbuf", args: ["-o0", "echo", "large"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
    async invoke() { invoked = true; return { exitCode: 0 }; },
  };
  await assert.rejects(async () => createStdbufCommand({ limits: { maxArgumentBytes: 4 } }).execute(context), { code: "EFBIG" });
  assert.equal(invoked, false);
});
