import assert from "node:assert/strict";
import test from "node:test";
import { createFdCommand, fdCommands } from "./index.js";

test("fd command definition exports standard contract", () => {
  const def = createFdCommand();
  assert.equal(def.name, "fd");
  assert.equal(typeof def.execute, "function");
});

 test("fd plugin rejects duplicate registrations unless replacement is explicit", async () => {
  const { CommandRegistry } = await import('safe-bash-contracts');
  const commands = new CommandRegistry();
  const host = { commands, use() {}, registerFileSystem() {} };
  await fdCommands().setup(host);
  assert.throws(() => fdCommands().setup(host), /already registered/);
  assert.throws(() => fdCommands({ replace: false }).setup(host), /already registered/);
  await fdCommands({ replace: true }).setup(host);
});
