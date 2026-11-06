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

for (const [input, serialized, canonical] of [
  ["<r><?task keep?></r>", "<r><?task keep?></r>", "<r><?task keep?></r>"],
  ["<!--pre--><r/><!--post-->", "<!--pre-->\n<r/>\n<!--post-->", "<!--pre-->\n<r></r>\n<!--post-->"],
  ["<?pre before?><r/><?post after?>", "<?pre before?>\n<r/>\n<?post after?>", "<?pre before?>\n<r></r>\n<?post after?>"],
  ["<!--pre--><?pre before?><r><!--inside--></r><?post after?><!--post-->",
    "<!--pre-->\n<?pre before?>\n<r><!--inside--></r>\n<?post after?>\n<!--post-->",
    "<!--pre-->\n<?pre before?>\n<r><!--inside--></r>\n<?post after?>\n<!--post-->"],
] as const) {
  for (const flags of ["", "--format", "--c14n", "--exc-c14n"]) {
    test(`xmllint substitution preserves document comments and processing instructions: ${flags} ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/doc.xml", new TextEncoder().encode(input));
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
      try {
        const body = flags === "--format" ? serialized
          .replace("<r><!--inside--></r>", "<r>\n  <!--inside-->\n</r>")
          .replace("<r><?task keep?></r>", "<r>\n  <?task keep?>\n</r>") : serialized;
        const expected = flags.includes("c14n") ? canonical : `<?xml version="1.0"?>\n${body}`;
        const direct = await shell.exec(`xmllint ${flags} /doc.xml`);
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.equal(direct.stdout, expected + (flags.includes("c14n") ? "" : "\n"));
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
