import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/command.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";

for (const flag of ["-g", "--gen-pot"]) {
  test(`awk ${flag} extracts marked strings without executing or reading records`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} 'BEGIN { print _"Independent"; print "ignored"; print _"Independent"; print _"Changed\\n\\"value\\""; print "effect" > "/effect" }' /missing`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'msgid "Independent"\nmsgstr ""\n\nmsgid "Changed\\n\\"value\\""\nmsgstr ""\n\n');
    assert.equal(result.stderr, "");
    await assert.rejects(fs.stat("/effect"));
  });
}

test("awk gettext markers evaluate to byte strings during ordinary execution", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  const result = await shell.exec('awk \'BEGIN { _="prefix"; print _"Changed", _ "ordinary" }\'');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Changed prefixordinary\n");
});

test("awk gettext extraction validates syntax and bounds generated text", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands({ maxBufferBytes: 16 })) });
  context.after(() => shell.dispose());
  const result = await shell.exec('awk -g \'BEGIN { print _"too large" }\'');
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /text buffer limit exceeded/u);
  const invalid = await shell.exec('awk -g \'BEGIN { print _"message"; if }\'');
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.stdout, "");
});
