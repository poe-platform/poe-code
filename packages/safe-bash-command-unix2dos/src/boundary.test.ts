import assert from "node:assert/strict";
import test from "node:test";
import { createUnix2dosCommand, createUnix2dosCommands, unix2dosCommands } from "./index.js";

test("unix2dos owns a single-command factory and collision-safe plugin", () => {
  assert.equal(createUnix2dosCommand().name, "unix2dos");
  assert.deepEqual(createUnix2dosCommands().map(command => command.name), ["unix2dos"]);
  const registered: string[] = [];
  const host = { commands: { has: () => true, register(command: { name: string }) { registered.push(command.name); } } };
  assert.throws(() => unix2dosCommands().setup(host as never), /already registered/);
  assert.deepEqual(registered, []);
  unix2dosCommands({ replace: true }).setup(host as never);
  assert.deepEqual(registered, ["unix2dos"]);
});
