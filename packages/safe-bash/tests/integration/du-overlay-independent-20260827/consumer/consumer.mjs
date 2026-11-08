import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Shell, createMemoryFileSystem } from "virtual-bash";
import { duCommands } from "./node_modules/virtual-bash/dist/commands/du/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = await realpath(join(here, "node_modules", "virtual-bash"));
const duPath = await realpath(join(packageRoot, "dist", "commands", "du", "index.js"));
const rootUrl = import.meta.resolve("virtual-bash");
const rootPath = await realpath(fileURLToPath(rootUrl));
const inside = (root, path) => {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
};
assert.ok(inside(packageRoot, duPath));
assert.ok(inside(packageRoot, rootPath));
assert.equal(resolve(duPath), fileURLToPath(pathToFileURL(duPath)));

const fs = createMemoryFileSystem();
await fs.mkdir("/moved");
await fs.writeFile("/moved/file", new Uint8Array(17));
const shell = new Shell({ fs }).use(duCommands());
let result;
try { result = await shell.exec("du -bs /moved"); }
finally { await shell.dispose(); }
assert.equal(result.exitCode, 0, result.stderr);
assert.equal(result.stdout, "17\t/moved\n");

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
process.stdout.write(`${JSON.stringify({
  cwd: process.cwd(), packageRoot, rootPath, duPath, rootUrl,
  packageRelativeToConsumer: relative(here, packageRoot),
  duSha256: sha256(await readFile(duPath)),
  rootSha256: sha256(await readFile(rootPath)),
  result,
}, null, 2)}\n`);
