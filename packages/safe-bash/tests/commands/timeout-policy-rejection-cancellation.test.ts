import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";

test("kill-after policy rejection preserves parent cancellation precedence", async () => {
  for (const cancelled of [true, false]) {
    const controller = new AbortController();
    const parentFailure = new Error("parent cancelled");
    const childFailure = new Error("child cleanup failed");
    const sink = { async write() {} };
    const context: CommandContext = {
      command: "timeout", args: ["-k0.03", "2", "child"],
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink, stderr: sink,
      cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: controller.signal,
    };
    const command = createTimeoutCommand({
      killAfterPolicy: async () => {
        if (cancelled) controller.abort(parentFailure);
        throw childFailure;
      },
    });
    await assert.rejects(async () => command.execute(context),
      (error: unknown) => error === (cancelled ? parentFailure : childFailure));
  }
});
