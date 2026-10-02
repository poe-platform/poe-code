import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/index.js";
import { commandRuntimeIdentity } from "../../../src/contracts/command.js";
import { Shell } from "../../../src/shell/shell.js";
import { createInstallCommand, createInstallCommands, installCommands } from "../../../src/commands/install/index.js";
import { seed } from "./helpers.js";

test("every install factory registers only with its matching command runtime", () => {
  const registry = new CommandRegistry();
  installCommands().setup({ commands: registry, use() {}, registerFileSystem() {} });
  const definitions = [createInstallCommand(), ...createInstallCommands(), registry.get("install")!];
  for (const definition of definitions) {
    assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
    assert.doesNotThrow(() => new CommandRegistry([definition]));
    const otherRuntime = Object.freeze({});
    assert.throws(() => new CommandRegistry([{ ...definition, runtimeIdentity: otherRuntime }]), /do not mix source and compiled runtime modules/u);
  }
});

test("opt-in factories and explicit replacement policy", () => {
  assert.equal(createInstallCommand().name, "install");
  assert.deepEqual(createInstallCommands().map(command => command.name), ["install"]);
  const commands = new CommandRegistry([{ name: "install", execute: () => ({ exitCode: 42 }) }]);
  const original = commands.get("install"), host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => installCommands().setup(host), /already registered/u);
  assert.equal(commands.get("install"), original);
  installCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("install"), original);
});

test("actual shell opt-in supports executable installation and directory operands", async () => {
  const fs = await seed(), shell = new Shell({ fs }).use(installCommands());
  try { assert.equal((await shell.exec("install -D -m 700 source bin/tool")).exitCode, 0); }
  finally { await shell.dispose(); }
  assert.equal((await fs.stat("/bin/tool")).mode & 0o7777, 0o700);
});