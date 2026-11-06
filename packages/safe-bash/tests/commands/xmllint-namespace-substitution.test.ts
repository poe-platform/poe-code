import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createXmllintCommands } from "../../src/commands/xml/index.js";

for (const input of [
  '<p:r xmlns:p="urn:test"><p:c/></p:r>',
  '<r xmlns="urn:test"><c xmlns=""><d/></c></r>',
  '<r xmlns:z="urn:z" xmlns:a="urn:a" z:a="1" a:z="2"><c xmlns:z="urn:other"><z:d/></c></r>',
]) {
  for (const flags of ["", "--format", "--c14n", "--exc-c14n"]) {
    test(`xmllint substitution preserves namespaces: ${flags} ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/doc.xml", new TextEncoder().encode(input));
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
      try {
        const direct = await shell.exec(`xmllint ${flags} /doc.xml`);
        assert.equal(direct.exitCode, 0, direct.stderr);
        const assignment = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"`);
        assert.equal(assignment.exitCode, direct.exitCode);
        assert.equal(assignment.stderr, direct.stderr);
        const captured = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"; printf %s "$value"`);
        assert.equal(captured.exitCode, 0, captured.stderr);
        assert.equal(captured.stdout, direct.stdout.trimEnd());
        if (flags === "--c14n" && input.startsWith("<p:r")) {
          assert.equal(captured.stdout, '<p:r xmlns:p="urn:test"><p:c></p:c></p:r>');
        }
      } finally { await shell.dispose(); }
    });
  }
}
