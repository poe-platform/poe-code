import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";

for (const flag of ["--help", "--version"]) test(`external false ${flag} retains failure status`, async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const builtin = await shell.exec(`false ${flag}`);
    assert.equal(builtin.exitCode, 1);
    assert.equal(builtin.stdout, "");
    const external = await shell.exec(`env false ${flag}`);
    assert.notEqual(external.stdout.length, 0);
    assert.equal(external.stderr, "");
    assert.equal(external.exitCode, 1);
  } finally { await shell.dispose(); }
});
