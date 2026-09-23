import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";

test("kill-after host policy receives parent cancellation in invocation options", async () => {
  const controller = new AbortController();
  const reason = new Error("parent cancelled");
  const sink = { async write() {} };
  const context: CommandContext = {
    command: "timeout", args: ["-k0.03", "2", "child"],
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink, stderr: sink,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: controller.signal,
  };
  let cancelled = false;
  const command = createTimeoutCommand({
    killAfterPolicy: async (_context, _child, _args, options) => {
      assert.equal(options.signal, controller.signal);
      options.signal!.addEventListener("abort", () => { cancelled = true; }, { once: true });
      controller.abort(reason);
      return { exitCode: 137 };
    },
  });
  await assert.rejects(async () => command.execute(context), (error: unknown) => error === reason);
  assert.equal(cancelled, true);
});
