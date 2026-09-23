import assert from "node:assert/strict";
import { test } from "node:test";
import { executionCommands } from "../../src/commands/execution.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { setup } from "./helpers.js";

for (const option of ["-v", "--debug", "-iv"]) {
  test(`env ${option} executes with GNU debug diagnostics`, async () => {
    const { shell, commands } = setup({ env: { KEEP: "parent" } });
    commands.register(createStandardCommands().find(command => command.name === "printf")!);
    for (const command of executionCommands(context => commands.get(context.command)!.execute(context))) commands.register(command);
    const result = await shell.exec(`env -i ${option} printf SYNTHETIC`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "SYNTHETIC");
    assert.equal(result.stderr, "cleaning environ\nexecuting: printf\n   arg[0]= 'printf'\n   arg[1]= 'SYNTHETIC'\n");
    assert.equal((await shell.exec("envget KEEP")).stdout, "parent");
  });
}

test("env debug reports mutations and preserves child status and stderr", async () => {
  const { shell, commands, fs } = setup({ env: { KEEP: "parent" } });
  await fs.mkdir("/child");
  for (const command of executionCommands(context => commands.get(context.command)!.execute(context))) commands.register(command);
  const result = await shell.exec("env -v -u KEEP -C /child ADDED=value both");
  assert.equal(result.stdout, "out\n");
  assert.equal(result.stderr, "unset:    KEEP\nsetenv:   ADDED=value\nchdir:    '/child'\nexecuting: both\n   arg[0]= 'both'\nerr\n");
  assert.equal((await shell.exec("env -iv status 7")).exitCode, 7);
});

test("env debug listing needs no command and verbose remains invalid", async () => {
  const { shell, commands } = setup();
  commands.register(createStandardCommands().find(command => command.name === "printf")!);
  for (const command of executionCommands(context => commands.get(context.command)!.execute(context))) commands.register(command);
  const result = await shell.exec("env -iv ADDED=value");
  assert.equal(result.stdout, "ADDED=value\n");
  assert.equal(result.stderr, "cleaning environ\nsetenv:   ADDED=value\n");
  assert.equal((await shell.exec("env --verbose printf SYNTHETIC")).exitCode, 2);
  assert.equal((await shell.exec("env -i printf SYNTHETIC")).stderr, "");
});
