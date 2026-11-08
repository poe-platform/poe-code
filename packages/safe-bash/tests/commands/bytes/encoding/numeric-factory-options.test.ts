import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createXxdCommand } from "../../../../src/commands/xxd/index.js";
import { createEncodingCommands } from "../../../../src/commands/bytes/encoding/index.js";
import { createOdCommand } from "../../../../src/commands/od/index.js";

for (const [name, create, args] of [["xxd", createXxdCommand, "-p"], ["od", createOdCommand, "-An -tx1"]] as const) {
  for (const route of ["numeric", "options", "aggregate"] as const) {
    for (const substitution of ["direct", "substitution", "pipeline"] as const) {
      test(`${name} ${route} input limits survive ${substitution}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", new Uint8Array([65, 66, 67]));
        const definitions = route === "aggregate" ? createEncodingCommands({ limits: { maxInputBytes: 2 } }) : [create(route === "numeric" ? 2 : { maxInputBytes: 2 })];
        const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...definitions]) });
        try {
          const command = substitution === "pipeline" ? `printf ABC | ${name} ${args}` : `${name} ${args} /input`;
          const source = substitution !== "direct" ? `for i in {1..3}; do output=$(${command}); rc=$?; done; exit "$rc"` : command;
          const result = await shell.exec(source);
          assert.equal(result.exitCode, 1, JSON.stringify(result));
          assert.ok(result.stderr.includes("EFBIG"), result.stderr);
          assert.equal(result.stdout, "");
        } finally { await shell.dispose(); }
      });
    }
}
}
