import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { splitCommands } from "../../src/commands/split/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const option of ["-t $'\\xfe'", "-t$'\\xfe'", "-et$'\\xfe'", "--separator $'\\xfe'", "--separator=$'\\xfe'"]) {
 for (const capture of [false, true]) {
  test(`split accepts raw separators through Shell: ${option}, capture=${capture}`, async context => {
   const fs = createMemoryFileSystem();
   await fs.writeFile("/in", Uint8Array.of(97, 254, 98, 10, 99, 10));
   const shell = new Shell({ fs, cwd: "/", env: { LC_ALL: "C" } }).use(splitCommands());
   context.after(() => shell.dispose());
   const command = `split -l1 ${option} /in`;
   const result = await shell.exec(capture ? `value=$(${command})` : command);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, "");
   assert.equal(result.stderr, "");
   assert.deepEqual(await fs.readFile("/xaa"), Uint8Array.of(97, 254, 98, 10));
   assert.deepEqual(await fs.readFile("/xab"), Uint8Array.of(99, 10));
   assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["in", "xaa", "xab"]);
  });
 }
}
