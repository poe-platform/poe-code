import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext } from "./timeout-author-20260828/fixtures.js";

test("a host kill-after policy does not acquire the cooperative invoker", async () => {
  const capture = captureContext(["-k0.03", "2", "child"]);
  Object.defineProperty(capture.context, "invoke", {
    get() { assert.fail("cooperative invocation is unavailable on this host"); },
  });
  const command = createTimeoutCommand({
    killAfterPolicy: async (_context, child) => {
      assert.equal(child, "child");
      return { exitCode: 9 };
    },
  });
  assert.deepEqual(await command.execute(capture.context), { exitCode: 9 });
});
