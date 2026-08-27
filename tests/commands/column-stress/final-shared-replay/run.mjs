import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const revision = "0123c83d3aae72a15621acbb29a165b97b2c6ab6";
const capture = resolve(process.argv[2] ?? join(directory, `capture-${Date.now()}`));
assert(capture.startsWith(`${directory}/`));
mkdirSync(capture);
const temporary = realpathSync(mkdtempSync("/tmp/safe-bash-column-final-"));
const candidate = join(temporary, "candidate");
mkdirSync(candidate);
const startedAt = new Date().toISOString();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
const fixtureCommit = "ee933d5d31d9c7da1bc77d523d545daaa4e8f382";
const fixturePath = "tests/commands/column-stress/current-contract-review";
const fixtureDirectory = join(temporary, "fixtures"); mkdirSync(fixtureDirectory);
const expectedBindings = { "src/shell/input.ts": "3eec71b72f87dd48ddac572d6e7feb9097d32be4", "src/commands/column": "8b32998383d1372a8624ac41d2e747551e5b6d4c", "src/commands/grep-aliases": "5e8ac069bfa6ead7a337130457cd6519f2066e2c" };
for (const ancestor of ["f8819e9d6b6d535b0626e0aa004bb10a7bc36785", "a809635432f18a235b8fb622a05367bedc54b315", "04644bc2c15d67155f5f4b170a66fc9bef3f6e3d"]) git("merge-base", "--is-ancestor", ancestor, revision);
for (const [path, expected] of Object.entries(expectedBindings)) assert.equal(git("rev-parse", `${revision}:${path}`).toString().trim(), expected, path);
const fixtures = [];
for (const file of ["probe.mjs", "loader.mjs", "consumer.mts", "run.mjs"]) {
  const path = `${fixturePath}/${file}`, bytes = git("show", `${fixtureCommit}:${path}`);
  assert.equal(hash(readFileSync(join(repository, path))), hash(bytes), `Live original fixture differs: ${path}`);
  assert.equal(hash(git("show", `${revision}:${path}`)), hash(bytes), `Candidate fixture differs: ${path}`);
  if (file === "probe.mjs") assert.equal(hash(bytes), "ca527d7a6e57d497f1c8118e64e3c416133b3b5eb558ca9f766a1dbaf64bbb08");
  if (file !== "run.mjs") writeFileSync(join(fixtureDirectory, file), bytes, { flag: "wx" });
  fixtures.push({ file, path, sha256: hash(bytes), bytes: bytes.length, unchangedFrom: fixtureCommit });
}
const runnerPath = "tests/commands/column-stress/padding-evolution/execution-20260827/runner.mjs";
const runnerBlob = git("show", `${revision}:${runnerPath}`);
assert.equal(hash(runnerBlob), "32ca0e1ad0425b6084cfd1bd3c4eb8f3c8d06cafee545a6df8ea7bbc0688cf2a");
const oldTemporary = "/tmp/safe-bash-column-padding-MmS9An";
assert.equal(runnerBlob.toString().split(oldTemporary).length - 1, 2);
const reboundRunner = runnerBlob.toString().replaceAll(oldTemporary, temporary);
const originalRunner = join(fixtureDirectory, "bounded.mjs");
writeFileSync(originalRunner, reboundRunner, { flag: "wx" });
writeFileSync(join(capture, "bounded.mjs.txt"), reboundRunner, { flag: "wx" });
const fixtureInventory = inventory(fixtureDirectory);
const binding = { revision, expectedBindings, verifiedAncestors: ["f8819e9d6b6d535b0626e0aa004bb10a7bc36785", "a809635432f18a235b8fb622a05367bedc54b315", "04644bc2c15d67155f5f4b170a66fc9bef3f6e3d"], receiptAt: new Date().toISOString(), beforeAnyCandidateImport: true, fixtureCommit, fixtures, fixtureInventory, runner: { path: runnerPath, originalSha256: hash(runnerBlob), reboundSha256: hash(reboundRunner), changedOnly: "Two absolute TMPDIR/npm-cache prefix bindings", oldTemporary, temporary }, wrapperSha256: hash(readFileSync(fileURLToPath(import.meta.url))), liveContext: { head: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--porcelain=v1").toString(), role: "receipt context only, never candidate product inputs" }, childEnvironment: { TSX_DISABLE_CACHE: "1", NODE_OPTIONS: "", NODE_PATH: "", TMPDIR: `${temporary}/`, npm_config_offline: "true", npm_config_ignore_scripts: "true" } };
json(join(capture, "BINDING.json"), binding);
const commands = [];
function run(label, cwd, executable, args, milliseconds = 90000, env = {}, expectedTermination = null, outputCap = 8388608) {
  const output = join(capture, `${label}.command.json`);
  let wrapperStatus = 0;
  try { execFileSync(process.execPath, [originalRunner, output, cwd, String(milliseconds), String(outputCap), executable, ...args], { env: { ...process.env, TSX_DISABLE_CACHE: "1", ...env }, timeout: milliseconds + 5000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { wrapperStatus = error.status; if (!existsSync(output)) throw error; }
  const result = readJson(output);
  commands.push({ label, wrapperStatus, expectedTermination, status: result.status, signal: result.signal, termination: result.termination, spawnError: result.spawnError, groupAliveAtClose: result.groupAliveAtClose, groupAliveAfterRetirement: result.groupAliveAfterRetirement });
  console.log(JSON.stringify(commands.at(-1)));
  assert.equal(result.termination, expectedTermination); assert.equal(result.spawnError, null); assert.equal(result.groupAliveAfterRetirement, false);
  if (expectedTermination) assert.equal(wrapperStatus, 1);
  else { assert.equal(result.signal, null); assert.equal(result.groupAliveAtClose, false); }
  return result;
}
async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest("hex");
}
function inventory(root, base = root) {
  const entries = [];
  for (const name of readdirSync(root).sort()) {
    const full = join(root, name), path = relative(base, full), stat = lstatSync(full);
    assert(!stat.isSymbolicLink(), `Regular-file snapshot only: ${full}`);
    if (stat.isDirectory()) { entries.push({ path, kind: "directory", mode: stat.mode & 0o777 }); entries.push(...inventory(full, base)); }
    else { assert(stat.isFile()); const bytes = readFileSync(full); entries.push({ path, kind: "file", mode: stat.mode & 0o777, bytes: bytes.length, sha256: hash(bytes) }); }
  }
  return entries;
}
const archive = join(temporary, "candidate.tar");
for (const [label, script, cause, milliseconds] of [
  ["runner-negative-deadline", "setInterval(()=>{},1000)", "deadline", 300],
  ["runner-negative-output", "process.stdout.write(Buffer.alloc(131072));setInterval(()=>{},1000)", "stdout-cap", 2000],
  ["runner-negative-leak", "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(child.pid));process.exit(0)", "surviving-process-group", 2000],
]) run(label, temporary, process.execPath, ["-e", script], milliseconds, {}, cause, 65536);
assert.equal(run("archive", repository, "git", ["archive", "--format=tar", `--output=${archive}`, revision]).status, 0);
const archiveSha256 = await hashFile(archive);
const extractor = "import os,sys,tarfile,shutil\nroot=sys.argv[2]\nwith tarfile.open(sys.argv[1]) as archive:\n for item in archive:\n  path=os.path.join(root,item.name)\n  assert os.path.commonpath([root,os.path.abspath(path)])==root\n  if item.isdir(): os.makedirs(path,exist_ok=True); continue\n  os.makedirs(os.path.dirname(path),exist_ok=True)\n  with open(path,'xb') as target:\n   if item.issym(): target.write(item.linkname.encode())\n   else:\n    assert item.isfile()\n    with archive.extractfile(item) as source: shutil.copyfileobj(source,target)\n  os.chmod(path,0o444)\n";
assert.equal(run("extract", temporary, "python3", ["-c", extractor, archive, candidate]).status, 0);
const sourceInventory = inventory(candidate);
const tree = git("ls-tree", "-rz", "--full-tree", revision).toString().split("\0").filter(Boolean);
const sourceFiles = [];
for (const row of tree) {
  const split = row.indexOf("\t"), [mode, type, blob] = row.slice(0, split).split(" "), path = row.slice(split + 1);
  assert.equal(type, "blob");
  const bytes = readFileSync(join(candidate, path));
  const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(actual, blob, path);
  sourceFiles.push({ path, gitMode: mode, blob, bytes: bytes.length, sha256: hash(bytes) });
}
assert.equal(sourceInventory.filter((entry) => entry.kind === "file").length, sourceFiles.length);
json(join(capture, "SOURCE.json"), { revision, archiveSha256, sourceFiles, membership: sourceInventory, snapshotProfile: "Whole Git archive; every blob byte preserved. Twelve unrelated native-fixture symlink blobs materialized as read-only regular link-text files; their Git modes retained in this manifest. No fixture dereferenced or executed." });
const lock = readJson(join(candidate, "package-lock.json")), installed = readJson(join(repository, "node_modules/.package-lock.json"));
const dependencies = [];
for (const [path, expected] of Object.entries(lock.packages)) {
  if (!path) continue;
  const origin = join(repository, path);
  if (!existsSync(origin)) { assert(expected.optional, path); continue; }
  assert(!lstatSync(origin).isSymbolicLink());
  assert.equal(readJson(join(origin, "package.json")).version, expected.version);
  assert.equal(installed.packages[path]?.integrity, expected.integrity);
  const before = inventory(origin);
  const target = join(candidate, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(origin, target, { recursive: true, dereference: false });
  assert.deepEqual(inventory(target), before);
  dependencies.push({ path, version: expected.version, declaredIntegrity: expected.integrity, files: before });
}
json(join(capture, "DEPENDENCIES.json"), { dependencies, caveat: "Installed locked versions/integrity declarations plus full regular-file hashes; copied, not installed; no fresh registry signature/tarball authentication." });
const tsx = join(candidate, "node_modules/tsx/dist/loader.mjs");
const compiler = join(candidate, "node_modules/typescript/bin/tsc");
assert.equal(run("build", candidate, process.execPath, [compiler, "-p", "tsconfig.build.json"]).status, 0);
const builtInventory = inventory(candidate);
const sourcePaths = new Set(sourceInventory.map((entry) => entry.path));
json(join(capture, "BUILT.json"), { inventorySha256: hash(JSON.stringify(builtInventory)), addedEntries: builtInventory.filter((entry) => !sourcePaths.has(entry.path)) });
const scopedTests = ["tests/commands/column-stress/owned-regressions.test.ts"];
const strictFlags = ["--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", "--types", "node"];
const types = run("scoped-types", candidate, process.execPath, [compiler, ...strictFlags, ...scopedTests]);
const tests = run("scoped-tests", candidate, process.execPath, ["--unhandled-rejections=strict", "--import", tsx, "--test", "--test-reporter=tap", ...scopedTests]);
const old = join(candidate, "tests/commands/column-stress/handoff-20260827");
const legacy = run("legacy", candidate, process.execPath, ["--unhandled-rejections=strict", join(old, "stress.mjs"), candidate, join(capture, "LEGACY.json")]);
const hidden = run("original-hidden", candidate, process.execPath, ["--unhandled-rejections=strict", join(old, "root-hidden-return-repro.mjs"), candidate, join(capture, "ORIGINAL-HIDDEN.json")]);
function probe(label, root, path, loader, mode, mutant = "none") {
  return run(label, dirname(path), process.execPath, [`--unhandled-rejections=${mutant === "late-unhandled" ? "throw" : "strict"}`, "--import", loader, path, root, join(capture, `${label}.json`), mode, mutant], 30000, { COLUMN_CANDIDATE: root, COLUMN_PROBE: path, COLUMN_IMPORTS: join(capture, `${label}.imports.ndjson`) });
}
const sourceProbe = join(fixtureDirectory, "probe.mjs"), sourceLoader = join(fixtureDirectory, "loader.mjs");
const sourceResult = probe("current", candidate, sourceProbe, sourceLoader, "source");
for (const mutant of ["remove-registration", "wrong-output", "wrong-error", "late-unhandled"]) probe(`mutant-${mutant}`, candidate, sourceProbe, sourceLoader, "source", mutant);
assert.deepEqual(inventory(candidate), builtInventory, "Before packing: append-proof complete candidate inventory");
const packDirectory = join(temporary, "pack"); mkdirSync(packDirectory);
const packCommand = run("pack", candidate, "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--cache", join(packDirectory, "cache"), "--pack-destination", packDirectory]);
assert.equal(packCommand.status, 0);
const packDetails = JSON.parse(Buffer.from(packCommand.stdoutHex, "hex").toString())[0];
const pack = join(packDirectory, packDetails.filename), packSha256 = await hashFile(pack);
const staging = join(temporary, "staging"); mkdirSync(join(staging, "node_modules/virtual-bash"), { recursive: true });
assert.equal(run("unpack", temporary, "tar", ["-xzf", pack, "--strip-components=1", "-C", join(staging, "node_modules/virtual-bash")]).status, 0);
for (const file of ["probe.mjs", "loader.mjs", "consumer.mts"]) copyFileSync(join(fixtureDirectory, file), join(staging, file));
const moved = join(temporary, "moved-offline"); renameSync(staging, moved);
const packed = join(moved, "node_modules/virtual-bash");
const packedInventory = inventory(moved), packedManifest = readJson(join(packed, "package.json"));
assert.deepEqual(packedManifest.dependencies ?? {}, {});
assert.equal(packedManifest.exports["./commands/column"], undefined);
const movedResult = probe("packed-current", packed, join(moved, "probe.mjs"), join(moved, "loader.mjs"), "packed");
const packedTypes = run("packed-types", moved, process.execPath, [compiler, ...strictFlags.filter((flag, index, flags) => flag !== "--types" && flags[index - 1] !== "--types"), "--typeRoots", join(candidate, "node_modules/@types"), "--types", "node", "--traceResolution", "consumer.mts"]);
assert.deepEqual(inventory(moved), packedInventory, "Moved package and consumer membership/hash stable");
json(join(capture, "PACK.json"), { packSha256, filename: packDetails.filename, manifest: packedManifest, inventory: packedInventory, inventorySha256: hash(JSON.stringify(packedInventory)), publicRoot: join(packed, "dist/index.js"), internalColumn: join(packed, "dist/commands/column/index.js"), movedFrom: staging, movedTo: moved, noRuntimeDependencies: true, caveat: "Public root Shell plus INTERNAL column file URL. No public column subpath export or integration approval." });
const after = inventory(candidate);
assert.deepEqual(after, builtInventory, "Append-proof full membership, modes and bytes after execution");
assert.equal(await hashFile(archive), archiveSha256);
assert.equal(await hashFile(pack), packSha256);
for (const dependency of dependencies) assert.deepEqual(inventory(join(repository, dependency.path)), dependency.files);
assert.deepEqual(inventory(fixtureDirectory), fixtureInventory);
for (const fixture of fixtures) assert.equal(hash(readFileSync(join(repository, fixture.path))), fixture.sha256);
for (const name of readdirSync(capture).filter((name) => name.endsWith(".imports.ndjson"))) {
  for (const line of readFileSync(join(capture, name), "utf8").trim().split("\n")) { const receipt = JSON.parse(line); assert.equal(hash(readFileSync(receipt.path)), receipt.sha256, receipt.path); }
}
const legacyResult = readJson(join(capture, "LEGACY.json"));
const summary = { revision, startedAt, finishedAt: new Date().toISOString(), temporary, archiveSha256, packSha256, sourceBlobCount: sourceFiles.length, sourceInventorySha256: hash(JSON.stringify(sourceInventory)), beforeInventorySha256: hash(JSON.stringify(builtInventory)), afterInventorySha256: hash(JSON.stringify(after)), newEntriesDetected: true, reusedDependenciesUnchanged: true, archiveUnchanged: true, packUnchanged: true, fixturesUnchanged: true, node: { version: process.version, platform: process.platform, architecture: process.arch, executable: process.execPath, sha256: await hashFile(process.execPath) }, commands, legacyCounts: legacyResult.counts, originalHidden: readJson(join(capture, "ORIGINAL-HIDDEN.json")), currentCounts: readJson(join(capture, "current.json")).counts, packedCounts: readJson(join(capture, "packed-current.json")).counts, scopedTestCounts: Object.fromEntries([...Buffer.from(tests.stdoutHex, "hex").toString().matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((match) => [match[1], Number(match[2])])), checks: { build: 0, types: types.status, tests: tests.status, legacy: legacy.status, hidden: hidden.status, current: sourceResult.status, packed: movedResult.status, packedTypes: packedTypes.status }, closure: "All child closes and process groups checked. Three intentional runner-negative terminations are separate; every other command has no timeout/output cap/leak/spawn failure. Fixture gates released and awaited. Temporary archive retained only until final audit/removal." };
json(join(capture, "SUMMARY.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if ([types, tests, sourceResult, movedResult, packedTypes].some((result) => result.status !== 0)) process.exitCode = 1;
