import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as root from "virtual-bash";

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = await realpath(join(consumerRoot, "node_modules", "virtual-bash"));
const rootPath = join(packageRoot, "dist", "index.js");
const duPath = join(packageRoot, "dist", "commands", "du", "index.js");
const du = await import(pathToFileURL(duPath).href);
assert.equal(typeof du.createDuCommand, "function");
assert.equal(Object.hasOwn(root, "createDuCommand"), false);
assert.equal(root.createAgentCommands().some(command => command.name === "du"), false);
let publicDuSubpathError;
try { await import("virtual-bash/commands/du"); }
catch (error) { publicDuSubpathError = error; }
assert.equal(publicDuSubpathError?.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
const sha256 = async path => createHash("sha256").update(await readFile(path)).digest("hex");
process.stdout.write(`${JSON.stringify({
  consumerRoot: await realpath(consumerRoot),
  packageRoot,
  rootPath,
  duPath,
  rootSha256: await sha256(rootPath),
  duSha256: await sha256(duPath),
  publicRootDuExportAbsent: true,
  publicDuSubpathAbsent: true,
  defaultAgentCommandsDuAbsent: true,
}, null, 2)}\n`);
