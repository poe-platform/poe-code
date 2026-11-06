import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createXmllintCommands } from "../../src/commands/xml/index.js";

for (const flags of ["--c14n", "--exc-c14n", "--format"]) {
  test(`xmllint ${flags} validates relative namespaces in substitution`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/doc.xml", new TextEncoder().encode('<r xmlns:p="relative"><p:x/></r>'));
    const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
    try {
      const direct = await shell.exec(`xmllint ${flags} /doc.xml`);
      const assignment = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"`);
      const captured = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"; printf %s "$value"`);
      if (flags === "--format") {
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.ok(direct.stdout.includes('xmlns:p="relative"'));
        assert.equal(direct.stderr, "");
      } else {
        assert.equal(direct.exitCode, 6, direct.stderr);
        assert.equal(direct.stdout, "");
        assert.ok(direct.stderr.includes("relative namespace URI"), direct.stderr);
      }
      assert.equal(assignment.exitCode, direct.exitCode, assignment.stderr);
      assert.equal(assignment.stdout, "");
      assert.equal(assignment.stderr, direct.stderr);
      assert.equal(captured.stdout, direct.stdout.trimEnd());
      assert.equal(captured.exitCode, 0, captured.stderr);
    } finally {
      await shell.dispose();
    }
  });
}

for (const [input, expected] of [
  ['<r a="1" Z="2" z="3" A="4"/>', '<r A="4" Z="2" a="1" z="3"></r>'],
  ['<r a="1" Z="2"/>', '<r Z="2" a="1"></r>'],
] as const) {
  for (const flags of ["--c14n", "--exc-c14n"]) {
    test(`xmllint ${flags} preserves canonical attribute order in substitution: ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/doc.xml", new TextEncoder().encode(input));
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
      try {
        const direct = await shell.exec(`xmllint ${flags} /doc.xml`);
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.equal(direct.stdout, expected);
        const assignment = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"`);
        assert.equal(assignment.exitCode, 0, assignment.stderr);
        assert.equal(assignment.stderr, "");
        const captured = await shell.exec(`value="$(xmllint ${flags} /doc.xml)"; printf %s "$value"`);
        assert.equal(captured.exitCode, 0, captured.stderr);
        assert.equal(captured.stdout, expected);
      } finally {
        await shell.dispose();
      }
    });
  }
}
