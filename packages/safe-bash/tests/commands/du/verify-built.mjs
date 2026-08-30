import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const build = process.argv[2];
if (!build) throw new Error("Pass an isolated build directory");
const { duCommands, createDuCommand, createDuCommands } = await import(pathToFileURL(join(build, "commands/du/index.js")).href);
const { createMemoryFileSystem } = await import(pathToFileURL(join(build, "fs/memory/index.js")).href);
const { Shell } = await import(pathToFileURL(join(build, "shell/index.js")).href);
const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array([1, 2, 3]));
assert.equal(createDuCommand().name, "du"); assert.equal(createDuCommands()[0].name, "du");
const shell = new Shell({ fs }).use(duCommands());
try {
  const result = await shell.exec("du -b file");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "3\tfile\n"); assert.equal(result.stderr, "");
} finally { await shell.dispose(); }
console.log(JSON.stringify({ boundary: "isolated built-module plugin and actual Shell", passed: true, rootPackageDuImportTested: false, packageDuSubpathTested: false }));
