import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { entries, fileHash, git, gitEnv, guard, hashProcess, inventory, json, limits, materialize, safePath, sha256, validateLinkBytes, validateTree } from "./core.mjs";
import { reconstruct } from "./reconstruct.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");
guard(process.argv.length === 6 && process.argv[5] === "--admission-build", "CLI", "run.mjs BINDINGS.json SHA256 NEW_OUTPUT_DIRECTORY --admission-build");
const bindingPath = resolve(process.argv[2]), bindingDirectory = dirname(bindingPath), bindingBytes = readFileSync(bindingPath);
guard(sha256(bindingBytes) === process.argv[3], "BINDING_HASH");
const binding = JSON.parse(bindingBytes), output = resolve(process.argv[4]);
mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "html-admission-v2-build-"))), source = join(scratch, "build");
const env = { PATH: `${dirname(binding.tools.node.path)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(scratch, "npm-cache"), npm_config_userconfig: join(scratch, "empty.npmrc"), npm_config_globalconfig: join(scratch, "empty-global.npmrc"), npm_config_update_notifier: "false" };
writeFileSync(env.npm_config_userconfig, "", { flag: "wx" });
writeFileSync(env.npm_config_globalconfig, "", { flag: "wx" });
const report = { schema: "html-admission-v2/1", started: new Date().toISOString(), bindingSha256: sha256(bindingBytes), candidate: binding.candidate, tree: binding.tree, scratch, limits, commands: [], candidateRuntimeCasesExecuted: 0, publicAcceptance: false, independentReview: "pending Raman through root", wholeGate: false };
json(join(output, "PRE.json"), { ...report, argv: process.argv, env, harnessAndInputs: inventory(here), tools: binding.tools, node: { path: realpathSync(process.execPath), sha256: fileHash(realpathSync(process.execPath)), version: process.version }, gitSha256: fileHash("/usr/bin/git"), tarSha256: fileHash("/usr/bin/tar") });
function command(name, executable, args, cwd = source) {
  const ordinal = String(report.commands.length + 1).padStart(3, "0");
  json(join(output, `${ordinal}-${name}.PRE.json`), { at: new Date().toISOString(), executable, executableSha256: fileHash(executable), args, cwd, env, bindingSha256: report.bindingSha256 });
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: limits.timeoutMs, maxBuffer: limits.commandBytes });
  const raw = { name, at: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  json(join(output, `${ordinal}-${name}.RAW.json`), raw);
  report.commands.push({ name, status: raw.status, raw: `${ordinal}-${name}.RAW.json` });
  guard(!result.error && !result.signal && result.status === 0, "COMMAND", name);
  return result.stdout;
}
async function archive(label) {
  const args = ["--no-replace-objects", "-C", repository, "archive", "--format=tar", binding.candidate];
  json(join(output, `${label}.PRE.json`), { at: new Date().toISOString(), executable: "/usr/bin/git", executableSha256: fileHash("/usr/bin/git"), args, env: gitEnv(), expected: binding.archive, limits, destination: "hash-only awaited sink; no tar file, extraction, or full archive buffering" });
  const result = await hashProcess("/usr/bin/git", args, { env: gitEnv() }, { expectedBytes: binding.archive.bytes, expectedSha256: binding.archive.sha256 });
  json(join(output, `${label}.RAW.json`), result);
  return result;
}
function checkFixtures() {
  for (const entry of binding.fixtures) {
    guard(fileHash(join(repository, entry.path)) === entry.sha256, "FROZEN18_BYTES", entry.path);
    const committed = entries(repository, binding.freeze, [entry.path]);
    assert.equal(committed[0]?.blob, entry.blob);
    assert.equal(committed[0]?.mode, entry.mode);
  }
}
try {
  const receiptRaw = gunzipSync(Buffer.from(readFileSync(join(bindingDirectory, "receipt.json.gz.base64"), "utf8"), "base64"), { maxOutputLength: limits.metadataBytes });
  guard(sha256(receiptRaw) === "f4abf562b80e31c1c43962ffc84820c6df8ea443e924adf693f238fca8e764d0", "RECEIPT_HASH");
  const receipt = JSON.parse(receiptRaw);
  assert.equal(receipt.candidateCommit, binding.candidate);
  assert.equal(receipt.archiveSha256, binding.archive.sha256);
  assert.equal(receipt.packSha256, binding.pack.sha256);
  assert.deepEqual(receipt.packFiles, binding.pack.files);
  checkFixtures();
  guard(git(repository, ["rev-parse", `${binding.candidate}^{tree}`]).toString().trim() === binding.tree, "CANDIDATE_TREE");
  const tree = entries(repository, binding.candidate);
  guard(sha256(JSON.stringify(tree)) === binding.fullTree.sha256, "FULL_TREE_METADATA");
  validateTree(tree, binding.links, binding.inputs);
  assert.equal(binding.inputs.length, 410);
  const selected = entries(repository, binding.candidate, binding.selectedRoots);
  assert.deepEqual(selected, binding.inputs.map(({ sha256: unused, ...entry }) => entry));
  for (const entry of tree.filter(entry => entry.mode === "120000")) {
    const bytes = git(repository, ["cat-file", "blob", entry.blob]);
    validateLinkBytes(entry, binding.links[entry.path], bytes);
  }
  for (const name of ["node", "npm", "tsc"]) guard(fileHash(binding.tools[name].path) === binding.tools[name].sha256, "TOOL", name);
  const toolManifests = {};
  for (const name of ["typescript", "nodeTypes", "undiciTypes", "npmRoot"]) {
    toolManifests[name] = inventory(binding.tools[name].path);
    guard(sha256(JSON.stringify(toolManifests[name])) === binding.tools[name].sha256, "TOOL_TREE", name);
  }
  report.archiveBefore = await archive("archive-before");
  report.materialized = await materialize(repository, source, tree, binding.links, binding.inputs);
  json(join(output, "INPUTS.json"), { count: binding.inputs.length, all410Sha256: sha256(JSON.stringify(binding.inputs)), materialized: report.materialized, inputs: binding.inputs });
  report.reconstruction = await reconstruct(repository, binding, bindingDirectory, output, join(scratch, "isolated.git"), source);
  mkdirSync(join(source, "node_modules", "@types"), { recursive: true });
  for (const [name, path] of [["typescript", "typescript"], ["nodeTypes", "@types/node"], ["undiciTypes", "undici-types"]]) {
    cpSync(binding.tools[name].path, join(source, "node_modules", path), { recursive: true, dereference: false, errorOnExist: true, force: false });
    assert.deepEqual(inventory(join(source, "node_modules", path)), toolManifests[name]);
  }
  const packageJson = JSON.parse(readFileSync(join(source, "package.json")));
  assert.equal(packageJson.name, "virtual-bash");
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.optionalDependencies ?? {}, {});
  assert.deepEqual(packageJson.files, ["dist"]);
  assert.deepEqual(packageJson.exports, receipt.packageExports);
  const beforeCompiler = inventory(source);
  json(join(output, "BUILD-VIEW-PRE.json"), beforeCompiler);
  const compiler = join(source, "node_modules/typescript/bin/tsc");
  const config = JSON.parse(command("compiler-config", binding.tools.node.path, [compiler, "-p", "tsconfig.build.json", "--showConfig"]));
  const expectedSource = binding.inputs.filter(entry => entry.path.startsWith("src/") && entry.path.endsWith(".ts")).map(entry => entry.path).sort();
  assert.deepEqual(config.files.map(path => path.replace(/^\.\//u, "")).sort(), expectedSource);
  const listed = command("compiler-inputs", binding.tools.node.path, [compiler, "-p", "tsconfig.build.json", "--listFilesOnly"]).trim().split("\n");
  const compilerInputs = listed.map(path => {
    const filename = realpathSync(path), relativePath = safePath(relative(source, filename));
    guard(filename.startsWith(`${source}/`) && Object.hasOwn(beforeCompiler, relativePath), "COMPILER_INPUT_OUTSIDE410_OR_TOOLS", filename);
    guard(relativePath.startsWith("src/") || relativePath.startsWith("node_modules/"), "COMPILER_INPUT_SCOPE", relativePath);
    return { path: relativePath, sha256: fileHash(filename) };
  });
  assert.deepEqual(compilerInputs.filter(entry => entry.path.startsWith("src/")).map(entry => entry.path).sort(), expectedSource);
  json(join(output, "COMPILER-INPUTS.json"), { candidateFiles: expectedSource.length, totalFilesIncludingAuthenticatedTools: compilerInputs.length, files: compilerInputs, closure: "actual TypeScript --listFilesOnly program and --showConfig; all candidate src TS present; config/package/README exact410; no source fallback; not runtime dynamic-import tracing" });
  command("build", binding.tools.node.path, [compiler, "-p", "tsconfig.build.json"]);
  report.emitted = inventory(join(source, "dist"));
  guard(Object.keys(report.emitted).length === 828, "EMITTED_COUNT");
  assert.deepEqual(Object.fromEntries(Object.entries(report.emitted).map(([path, hash]) => [`dist/${path}`, hash])), Object.fromEntries(Object.entries(binding.pack.files).filter(([path]) => path.startsWith("dist/"))));
  const afterBuild = inventory(source);
  assert.deepEqual(Object.fromEntries(Object.entries(afterBuild).filter(([path]) => !path.startsWith("dist/"))), beforeCompiler);
  const packDirectory = join(scratch, "pack"); mkdirSync(packDirectory);
  const pack = JSON.parse(command("npm-pack", binding.tools.node.path, [binding.tools.npm.path, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", packDirectory]));
  guard(pack.length === 1 && typeof pack[0].filename === "string" && !pack[0].filename.includes("/"), "PACK_FILENAME");
  const tarball = join(packDirectory, pack[0].filename);
  guard(fileHash(tarball) === binding.pack.sha256, "PACK_HASH");
  guard(pack[0].files.length === 830, "PACK_COUNT");
  assert.deepEqual(pack[0].files.map(entry => entry.path).sort(), Object.keys(binding.pack.files).sort());
  const names = command("pack-paths", "/usr/bin/tar", ["-tzf", tarball], scratch).trim().split("\n");
  assert.equal(names.length, 830);
  for (const name of names) { guard(name.startsWith("package/"), "PACK_PATH"); safePath(name); }
  const verbose = command("pack-kinds", "/usr/bin/tar", ["-tvzf", tarball], scratch).trim().split("\n");
  guard(verbose.length === 830 && verbose.every(line => line.startsWith("-")), "PACK_LINK_OR_KIND");
  const packed = join(scratch, "packed"); mkdirSync(packed);
  command("pack-extract", "/usr/bin/tar", ["-xzf", tarball, "-C", packed], scratch);
  const packedFiles = inventory(join(packed, "package"));
  assert.deepEqual(packedFiles, binding.pack.files);
  json(join(output, "PACK.json"), { sha256: fileHash(tarball), tarballBytes: readFileSync(tarball).length, files: packedFiles, count: Object.keys(packedFiles).length, emittedCount: Object.keys(report.emitted).length, npmMetadata: pack[0], runtimeExecuted: false });
  writeFileSync(join(output, "package.tgz.base64"), `${readFileSync(tarball).toString("base64")}\n`, { flag: "wx" });
  assert.deepEqual(inventory(source), afterBuild);
  for (const name of ["typescript", "nodeTypes", "undiciTypes", "npmRoot"]) assert.deepEqual(inventory(binding.tools[name].path), toolManifests[name]);
  report.archiveAfter = await archive("archive-after");
  checkFixtures();
  report.pack = { sha256: fileHash(tarball), files: Object.keys(packedFiles).length, emitted: Object.keys(report.emitted).length };
  report.compilerInputs = compilerInputs.length;
  report.appendProof = "Recursive complete file inventories before/after detect added files and all symlinks within build/packed views; newly added empty directories are not tracked. Original18file checks authenticate only original paths, not an append-proof original fixture directory (admission-v2 intentionally adds a sibling subtree). Full Git archive rehash is immutable candidate-only, not live user-tree admission.";
  report.status = "admission-proof-complete-review-pending";
} catch (error) {
  report.status = "failed";
  report.error = { message: error.message, code: error.code, stack: error.stack, process: error.process };
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  delete report.emitted;
  json(join(output, "REPORT.json"), report);
  console.log(JSON.stringify({ output, status: report.status, error: report.error?.message, materialized: report.materialized, pack: report.pack, runtimeCases: report.candidateRuntimeCasesExecuted }));
}
