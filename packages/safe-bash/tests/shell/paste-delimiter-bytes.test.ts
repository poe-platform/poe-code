import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { pasteCommands } from "../../src/commands/paste/index.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

for (const options of ["-sd $'\\xff'", "-s -d $'\\xff'", "-s --del=$'\\xff'"]) {
 for (const captured of [false, true]) {
  test(`paste preserves raw delimiter bytes through shell ${options}, captured=${captured}`, async context => {
   const fs = new MemoryFileSystem();
   const shell = new Shell({ fs }).use(standardCommands()).use(pasteCommands());
   context.after(() => shell.dispose());
   await fs.writeFile("/rows", new TextEncoder().encode("1\n2\n3\n4\n"));
   const command = `paste ${options} /rows`;
   const body = captured ? `for ((i=0;i<2;i++)); do x=$(${command}); done; printf '%s\\n' "$x"` : command;
   const result = await shell.exec(`export LC_ALL=C; ${body}`);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.deepEqual(result.stdoutBytes, Uint8Array.of(49, 255, 50, 255, 51, 255, 52, 10));
  });
 }
}
