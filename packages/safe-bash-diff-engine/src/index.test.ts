import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { Budget, ToolError } from "./shared.js";
test("diff diagnostics retain the requested exit code", () => {
 const error = new ToolError("invalid patch", 1);
 assert.equal(error.message, "invalid patch");
 assert.equal(error.exitCode, 1);
});

test("first work quantum services queued cancellation with a frozen clock", async t => {
  t.mock.method(performance, "now", () => 0);
  const controller = new AbortController();
  const reason = { cancellation: "first quantum" };
  const budget = new Budget({
    command: "diff", args: [], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
    signal: controller.signal,
  }, { maxWork: 4096, maxOutputBytes: 1 });
  budget.step(4095);
  assert.equal(budget.checkpoint(), undefined);
  const turn = setImmediate(() => controller.abort(reason));
  try {
    budget.step();
    const pending = budget.checkpoint();
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, error => error === reason);
    assert.throws(() => budget.step(), error => error === reason);
  } finally { clearImmediate(turn); }
});
