import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";

for (const entry of [
  { args: "ignored -L", external: "/alias", builtin: "/alias" },
  { args: "-P ignored -L", external: "/alias", builtin: "/work" },
  { args: "-L ignored -P", external: "/work", builtin: "/alias" },
]) test(`external pwd permutes ${entry.args} while builtin stops at operand`, async () => {
  const fs = await fixture();
  await fs.symlink("/work", "/alias");
  const shell = new Shell({ fs, cwd: "/alias", commands: new CommandRegistry(createStandardCommands()) });
  try {
    const builtin = await shell.exec(`pwd ${entry.args}`);
    assert.equal(builtin.stdout, `${entry.builtin}\n`);
    const external = await shell.exec(`env pwd ${entry.args}`);
    assert.equal(external.exitCode, 0);
    assert.equal(external.stdout, `${entry.external}\n`);
  } finally { await shell.dispose(); }
});

test("builtin pwd ignores help after an operand in direct handlers", async () => {
  const result = await run("pwd", ["ignored", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "/work\n");
});

test("external pwd invalid option has GNU failure status", async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const builtin = await shell.exec("pwd -X");
    assert.equal(builtin.exitCode, 2);
    const external = await shell.exec("env pwd -X");
    assert.equal(external.stdout, "");
    assert.notEqual(external.stderr.length, 0);
    assert.equal(external.exitCode, 1);
  } finally { await shell.dispose(); }
});
