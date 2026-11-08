import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const build = process.argv[2];
if (!build) throw new Error("Pass isolated build directory");
const { duCommands } = await import(pathToFileURL(join(build, "commands/du/index.js")).href);
const { createMemoryFileSystem } = await import(pathToFileURL(join(build, "fs/memory/index.js")).href);
const { Shell } = await import(pathToFileURL(join(build, "shell/index.js")).href);
const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
for (const env of [{ DU_BLOCK_SIZE: "bad", BLOCK_SIZE: "1" }, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1", POSIXLY_CORRECT: "" }]) {
  const shell = new Shell({ fs, env }).use(duCommands());
  try {
    const result = await shell.exec("du --apparent-size file");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, `${Object.hasOwn(env, "POSIXLY_CORRECT") ? 3 : 2}\tfile\n`); assert.equal(result.stderr, "");
    const invalid = await shell.exec("du -Bbad file"); assert.equal(invalid.exitCode, 1); assert.equal(invalid.stdout, "");
    const empty = await shell.exec("du -b '' file"); assert.equal(empty.exitCode, 1); assert.equal(empty.stdout, "1025\tfile\n"); assert.equal(empty.stderr, "du: invalid zero-length file name\n");
  } finally { await shell.dispose(); }
}
console.log(JSON.stringify({ boundary: "isolated built-module/plugin actual Shell", checks: 6, publicPackageImportsClaimed: false }));
