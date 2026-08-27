import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [scratch, output] = process.argv.slice(2);
assert(scratch && output);
const repository = "/Users/kjopek/Workspace/safe-bash";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const before = JSON.parse(await readFile(join(scratch, "auth-before.json")));
async function inventory(directory, root = directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) files.push({ path: relative(root, path), link: await readlink(path) });
    else if (stat.isDirectory()) files.push(...await inventory(path, root));
    else files.push({ path: relative(root, path), sha256: hash(await readFile(path)) });
  }
  return files;
}
const dependencies = [];
for (const dependency of before.dependencies) {
  const actual = await inventory(join(repository, dependency.path));
  assert.deepEqual(actual, dependency.files, dependency.path);
  dependencies.push({ path: dependency.path, version: dependency.version, files: actual.length, inventorySha256: hash(JSON.stringify(actual)), declaredIntegrity: dependency.declaredIntegrity });
}
const start = JSON.parse(await readFile(join(scratch, "tree-before-build.json")));
const runtime = JSON.parse(await readFile(join(scratch, "tree-before-runtime.json")));
const initialPaths = new Set(start.entries.map((entry) => entry.path));
const generated = runtime.entries.filter((entry) => !initialPaths.has(entry.path));
assert(generated.every((entry) => entry.path.startsWith("dist/")));
const originalEntries = runtime.entries.filter((entry) => initialPaths.has(entry.path));
assert.deepEqual(originalEntries, start.entries);
const prep = JSON.parse(await readFile(join(repository, "tests/commands/column-stress/padding-evolution/provenance.json")));
for (const entry of prep.historicalInventory) assert.equal(hash(await readFile(join(repository, entry.path))), entry.sha256);
const sealed = JSON.parse(await readFile(join(repository, "tests/commands/column-stress/padding-evolution/seal.json")));
for (const entry of sealed.files) assert.equal(hash(await readFile(join(repository, "tests/commands/column-stress/padding-evolution", entry.path))), entry.sha256);
const processFiles = (await readdir(join(scratch, "run1"))).filter((name) => name.endsWith("-process.json")).map((name) => join(scratch, "run1", name));
processFiles.push(...(await readdir(scratch)).filter((name) => name.endsWith("-process.json") || name === "build.json").map((name) => join(scratch, name)));
const processes = [];
for (const path of processFiles) {
  const record = JSON.parse(await readFile(path));
  if (Object.hasOwn(record, "groupAliveAfterRetirement")) assert.equal(record.groupAliveAfterRetirement, false, path);
  else { assert.equal(relative(scratch, path), "build.json"); assert.equal(record.groupAliveAtClose, false); }
  let alive = false;
  try { process.kill(-record.pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
  assert.equal(alive, false, `Owned group remains: ${record.pid}`);
  processes.push({ capture: relative(scratch, path), pid: record.pid, status: record.status, signal: record.signal, termination: record.termination, groupAlive: alive, captureHasPostRetirementProbe: Object.hasOwn(record, "groupAliveAfterRetirement") });
}
const packageRoot = join(scratch, "moved/node_modules/virtual-bash");
const packed = JSON.parse(await readFile(join(scratch, "packed-runtime.json")));
assert.deepEqual(await inventory(packageRoot), packed.packageInventory);
assert.equal(await lstat(join(scratch, "pack-staging/package")).then(() => true, (error) => { assert.equal(error.code, "ENOENT"); return false; }), false);
const sourceTree = execFileSync("git", ["rev-parse", "a8096354:src/commands/column"], { cwd: repository, encoding: "utf8" }).trim();
const aliasTree = execFileSync("git", ["rev-parse", "a8096354:src/commands/grep-aliases"], { cwd: repository, encoding: "utf8" }).trim();
assert.equal(aliasTree, execFileSync("git", ["rev-parse", "04644bc2:src/commands/grep-aliases"], { cwd: repository, encoding: "utf8" }).trim());
const result = { at: new Date().toISOString(), sourceTree, sourceDigest: runtime.sourceDigest, archive: { path: join(scratch, "a8096354.tar"), sha256: hash(await readFile(join(scratch, "a8096354.tar"))), originalGitBlobs: before.verifiedGitBlobs, originalTrackedFixtureSymlinks: start.entries.filter((entry) => entry.link && !entry.path.startsWith("node_modules/")).length, sourceFilesAreRegular: true }, aliasTree, sourceAndRuntimeMembership: { originalGitCommit: "a809635432f18a235b8fb622a05367bedc54b315", beforeBuildInventorySha256: start.inventorySha256, beforeRuntimeInventorySha256: runtime.inventorySha256, generatedFiles: generated, detection: "Recursive file and symlink membership, including additions; empty directories are not inventoried. Source symlinks forbidden; Git fixture links authenticated without following them." }, dependencies, dependencyCaveat: before.dependencyCaveat, tools: { node: { version: process.version, executable: await realpath(process.execPath), sha256: hash(await readFile(process.execPath)) }, compiler: { version: JSON.parse(await readFile(join(repository, "node_modules/typescript/package.json"))).version, tscSha256: hash(await readFile(join(repository, "node_modules/typescript/lib/_tsc.js"))) }, npmVersion: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() }, package: { tarPath: join(scratch, "pack-output/virtual-bash-0.0.0.tgz"), tarSha256: hash(await readFile(join(scratch, "pack-output/virtual-bash-0.0.0.tgz"))), packageRoot: await realpath(packageRoot), inventorySha256: packed.packageInventorySha256, entries: packed.packageInventory.length, originalExtractionAbsent: true, unchangedAfterRuntime: true, rootUrl: packed.rootUrl, columnUrl: packed.columnUrl }, historicalFilesUnchanged: prep.historicalInventory.length, prepFilesUnchanged: sealed.files.length + 1, processes, ownedGroupsRemaining: 0 };
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, sourceDigest: result.sourceDigest, archiveSha256: result.archive.sha256, packageSha256: result.package.tarSha256, processesChecked: processes.length, ownedGroupsRemaining: 0 }));
