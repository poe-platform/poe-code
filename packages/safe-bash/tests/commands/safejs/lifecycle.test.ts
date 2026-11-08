import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/index.js";
import { createSafeJsCommands, safeJsCommands } from "../../../src/commands/safejs/index.js";
import { contractRuntime } from "./helpers.js";

test("JavaScript plugin collision is explicit and only node is registered", async () => {
  const runtime = contractRuntime(async () => {});
  const commands = new CommandRegistry();
  const host = { commands, use() {}, registerFileSystem() {} };
  await safeJsCommands({ runtime }).setup(host);
  assert.equal(commands.has("node"), true);
  assert.equal(commands.has("safejs"), false);
  assert.equal(commands.has("js"), false);
  assert.throws(() => safeJsCommands({ runtime }).setup(host), /already registered/u);
  const first = commands.get("node");
  await safeJsCommands({ runtime, replace: true }).setup(host);
  assert.notEqual(commands.get("node"), first);
});

for (const limits of [{ timeoutMs: 0 }, { maxInputBytes: -1 }, { maxSteps: NaN }, { dataSize: 1.5 }]) {
  test(`invalid host limits reject before registration: ${JSON.stringify(limits)}`, () => {
    assert.throws(() => createSafeJsCommands({ runtime: contractRuntime(async () => {}), limits }), RangeError);
  });
}

test("partially supplied runtime factories fail closed", () => {
  assert.throws(() => createSafeJsCommands({ runtime: {} } as never), /runtime.run/u);
});
