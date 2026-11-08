import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createXmllintCommands } from "../../src/commands/xml/index.js";

for (const input of [
  '<r xml:space="preserve">  <a/>   <b/>  </r>',
  '<r xml:space="preserve">  <a> <b/>   <c/> </a>  </r>',
]) {
  for (const flags of ["", "--format"]) {
    test(`xmllint substitution preserves XML whitespace: ${flags} ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/doc.xml", new TextEncoder().encode(input));
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
      try {
        const expected = `<?xml version="1.0"?>\n${input}`;
        const direct = await shell.exec(`xmllint ${flags} /doc.xml`);
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.equal(direct.stderr, "");
        assert.equal(direct.stdout, expected + "\n");
        const assignment = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"`);
        assert.equal(assignment.exitCode, 0, assignment.stderr);
        assert.equal(assignment.stderr, "");
        const captured = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"; printf %s "$value"`);
        assert.equal(captured.exitCode, 0, captured.stderr);
        assert.equal(captured.stdout, expected);
      } finally { await shell.dispose(); }
    });
  }
}
