import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

for (const value of ["abcdefghij", "é".repeat(10), "界".repeat(10), "😀".repeat(10)]) {
  for (const [setup, command, output] of [
    ["", `echo '${value}'`, `${value}\n`],
    ["", `printf %s '${value}'`, value],
    [`cd '/${value}';`, "pwd", `/${value}\n`],
    ["", `command -v /${value}/tool`, `/${value}/tool\n`],
  ] as const) {
    for (const offset of [-1, 0]) {
      test(`substitution output byte boundary: ${command}, ${offset}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir(`/${value}`, { recursive: true });
        await fs.writeFile(`/${value}/tool`, new Uint8Array(), { mode: 0o755 });
        const commands = new CommandRegistry(basicCommands());
        const shell = new Shell({ fs, ...(command.startsWith("echo") || command.startsWith("printf") ? { commands } : {}), limits: { maxOutputBytes: Buffer.byteLength(output) + offset } });
        try {
          const run = shell.exec(`${setup} X="prefix$(${command})"`);
          if (offset < 0) await assert.rejects(run, /maxOutputBytes/);
          else assert.equal((await run).exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}
