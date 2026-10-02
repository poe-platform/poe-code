import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/index.js";
import { createCmpCommand, createCmpCommands, cmpCommands } from "../../../src/commands/cmp/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";

test("opt-in definitions, plugin collision policy, and actual Shell invocation", async () => {
  assert.equal(createCmpCommand().name, "cmp");
  assert.deepEqual(createCmpCommands().map(command => command.name), ["cmp"]);
  const commands = new CommandRegistry(createCmpCommands());
  assert.throws(() => cmpCommands().setup({ commands } as never), /already registered/);
  cmpCommands({ replace: true }).setup({ commands } as never);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a\nb"));
  await fs.writeFile("/right", Buffer.from("a\nc"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(cmpCommands());
  try {
    const result = await shell.exec("cmp /left /right");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "/left /right differ: char 3, line 2\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
