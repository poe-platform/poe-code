import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const frozen = path.dirname(own);
const repository = path.resolve(own, "../../../..");
const candidate = "284857d7aa9b0ee0df2b6fdd1a71f41115d7b909";
const rootSource = "ee1f69e721e350fcc77d634b92e5c9f13f61dedb";
const evidence = "44e3f1e3";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const child = spawnSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr.toString());
  return child.stdout;
};
const freeze = JSON.parse(fs.readFileSync(path.join(frozen, "FREEZE.json"), "utf8"));
for (const [name, sha256] of Object.entries(freeze.fixtureHashes)) assert.equal(hash(fs.readFileSync(path.join(frozen, name))), sha256);
const author = JSON.parse(git("show", `${evidence}:tests/plugins/which-public-author/REPORT.json`));
const binding = JSON.parse(git("show", `${evidence}:tests/plugins/which-public-author/CANDIDATE.json`));
assert.equal(binding.candidate, candidate);
assert.equal(binding.rootSource, rootSource);
assert.deepEqual(git("diff", "--name-only", binding.base, candidate).toString().trim().split("\n").sort(), binding.changes.map(entry => entry.path).sort());
for (const entry of binding.changes) assert.equal(hash(git("show", `${candidate}:${entry.path}`)), hash(git("show", `${entry.sourceRevision}:${entry.path}`)));
const names = git("ls-tree", "-r", "--name-only", candidate, "src").toString().trim().split("\n").filter(name => path.basename(name) !== "AGENTS.md");
names.push("package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md");
assert.deepEqual([...names].sort(), author.selectedBuildInputs.map(entry => entry.path).sort());
const sourceHashes = Object.fromEntries(names.map(name => [name, hash(git("show", `${candidate}:${name}`))]));
for (const entry of author.selectedBuildInputs) assert.equal(sourceHashes[entry.path], entry.sha256);
const archive = git("archive", "--format=tar.gz", candidate, ...names);
const output = path.join(own, `${process.argv[2] ?? "actual-01"}.json.gz.base64`);
assert.equal(fs.existsSync(output), false, "Immutable evidence");
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "public-which284-independent-")));
const source = path.join(temporary, "source");
const tooling = path.join(temporary, "tooling/node_modules");
const records = [];
const result = { capturedAt: new Date().toISOString(), candidate, rootSource, baseline76: binding.base, authorEvidence: git("rev-parse", `${evidence}^{commit}`).toString().trim(),
  freeze: "02ccea66d1e7983056c0ed114f8842fbd7ec3255", fixtureHashes: freeze.fixtureHashes, temporary,
  sourceHashes, archiveSha256: hash(archive), archiveBase64: archive.toString("base64"), records,
  node: { version: process.version, platform: process.platform, arch: process.arch, sha256: hash(fs.readFileSync(process.execPath)) },
  harness: Object.fromEntries(["run.mjs", "guard.mjs", "mutations.json"].map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")])),
  fixtureBytes: Object.fromEntries(["cohort.mjs", "cases.json", "types.json", "negative-plan.json"].map(name => [name, fs.readFileSync(path.join(frozen, name)).toString("base64")])) };
const inventory = root => {
  const entries = {};
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, filename);
      if (stat.isDirectory()) walk(filename);
      else { assert.ok(stat.isFile()); assert.notEqual(name, "AGENTS.md"); entries[path.relative(root, filename)] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size, mode: stat.mode & 0o777 }; }
    }
  };
  walk(root);
  return entries;
};
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1", npm_config_cache: path.join(temporary, "npm-cache") };
function execute(label, executable, args, cwd, extra = {}) {
  const started = performance.now();
  const child = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const record = { label, executable, args, cwd, pid: child.pid, status: child.status, signal: child.signal, error: child.error?.message,
    stdout: child.stdout, stderr: child.stderr, durationMs: Math.round(performance.now() - started) };
  records.push(record);
  console.log(JSON.stringify({ label, status: child.status, signal: child.signal, durationMs: record.durationMs }));
  assert.equal(child.error, undefined, label);
  assert.equal(child.signal, null, label);
  if (child.pid) assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH");
  record.directChildGone = true;
  return record;
}
function guarded(label, root, args, packageRoot, stage = "installed", hooks = {}) {
  const hashes = {};
  const before = inventory(root);
  for (const directory of [root, path.dirname(tooling)]) for (const [name, entry] of Object.entries(inventory(directory))) hashes[path.join(directory, name)] = entry.sha256;
  const guard = path.join(temporary, "guard.mjs");
  hashes[guard] = hash(fs.readFileSync(guard));
  const logs = path.join(temporary, `${label}-loads`);
  fs.mkdirSync(logs);
  const manifest = path.join(temporary, `${label}-manifest.json`);
  fs.writeFileSync(manifest, JSON.stringify({ hashes, logs }));
  hooks.before?.();
  const record = execute(label, process.execPath, args, root, { NODE_OPTIONS: `--import=${guard}`, PUBLIC_WHICH_MANIFEST: manifest,
    PUBLIC_WHICH_LAYOUT: stage, PUBLIC_WHICH_PACKAGE_ROOT: packageRoot });
  record.loads = fs.readdirSync(logs).flatMap(name => fs.readFileSync(path.join(logs, name), "utf8").trim().split("\n").filter(Boolean).map(line => ({ pid: Number(name.split(".")[0]), ...JSON.parse(line) })));
  for (const entry of record.loads) assert.equal(entry.sha256, hashes[entry.filename]);
  hooks.after?.();
  assert.deepEqual(inventory(root), before);
  return record;
}
const typeFamilies = JSON.parse(fs.readFileSync(path.join(frozen, "types.json"), "utf8"));
function typeArguments(root, id) {
  return [path.join(tooling, "typescript/bin/tsc"), ...typeFamilies.compilerOptions, "--typeRoots", path.join(tooling, "@types"), "--listFiles", path.join(root, `${id}.mts`)];
}
function prepareFixtures(root) {
  for (const name of ["cohort.mjs", "cases.json"]) fs.copyFileSync(path.join(frozen, name), path.join(root, name));
  for (const family of typeFamilies.cases) fs.writeFileSync(path.join(root, `${family.id}.mts`), family.source);
}
function layout(label, root) {
  const packageRoot = path.join(root, "node_modules/virtual-bash");
  const before = inventory(root);
  const runtime = guarded(`${label}-runtime18`, root, ["--unhandled-rejections=strict", "--test", "--test-concurrency=1", "cohort.mjs"], packageRoot, label);
  for (const family of typeFamilies.cases) guarded(`${label}-${family.id}`, root, typeArguments(root, family.id), packageRoot, label);
  result.layouts ??= {};
  result.layouts[label] = { before, after: inventory(root), loadedProduct: [...new Set(runtime.loads.filter(entry => entry.filename.startsWith(packageRoot + path.sep)).map(entry => entry.filename))] };
  assert.deepEqual(result.layouts[label].after, before);
}
try {
  fs.mkdirSync(source);
  const extracted = spawnSync("tar", ["-xz", "-C", source], { input: archive });
  assert.equal(extracted.status, 0, extracted.stderr.toString());
  const sourceBefore = inventory(source);
  assert.deepEqual(Object.keys(sourceBefore).sort(), names.sort());
  for (const [name, entry] of Object.entries(sourceBefore)) assert.equal(entry.sha256, sourceHashes[name]);
  result.sourceInventory = sourceBefore;
  result.tools = {};
  for (const name of ["typescript", "@types/node", "undici-types"]) {
    const input = path.join(repository, "node_modules", name);
    const before = inventory(input);
    const target = path.join(tooling, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(input, target, { recursive: true });
    assert.deepEqual(inventory(target), before);
    assert.deepEqual(inventory(input), before);
    result.tools[name] = { version: JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).version, files: before };
  }
  const toolsBefore = inventory(path.dirname(tooling));
  fs.copyFileSync(path.join(own, "guard.mjs"), path.join(temporary, "guard.mjs"));
  const build = execute("build", process.execPath, [path.join(tooling, "typescript/bin/tsc"), "-p", "tsconfig.build.json", "--typeRoots", path.join(tooling, "@types"), "--listFiles"], source);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  result.emittedInventory = inventory(path.join(source, "dist"));
  const packRoot = path.join(temporary, "pack");
  fs.mkdirSync(packRoot);
  const pack = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packRoot], source);
  assert.equal(pack.status, 0, pack.stderr);
  const metadata = JSON.parse(pack.stdout)[0];
  const tarball = path.join(packRoot, metadata.filename);
  const bytes = fs.readFileSync(tarball);
  assert.equal(hash(bytes), "49191d098e1e9f5b946f24dd898377144062110047cf6975d3cbf5d2c71214c0");
  result.package = { sha256: hash(bytes), metadata, base64: bytes.toString("base64") };
  const installed = path.join(temporary, "installed");
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const installation = execute("offline-install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", tarball], installed);
  assert.equal(installation.status, 0, installation.stderr);
  const product = path.join(installed, "node_modules/virtual-bash");
  assert.equal(fs.existsSync(path.join(product, "src")), false);
  assert.deepEqual(inventory(path.join(product, "dist")), result.emittedInventory);
  prepareFixtures(installed);
  layout("installed", installed);
  const moved = path.join(temporary, "physically-moved");
  fs.renameSync(installed, moved);
  fs.renameSync(source, path.join(temporary, "archived-source-not-admitted"));
  assert.equal(fs.existsSync(installed), false);
  assert.equal(fs.existsSync(source), false);
  layout("moved", moved);
  const positiveBefore = inventory(moved);
  result.mutations = [];
  for (const mutation of JSON.parse(fs.readFileSync(path.join(own, "mutations.json"), "utf8"))) {
    const mutant = path.join(temporary, mutation.id);
    fs.cpSync(moved, mutant, { recursive: true });
    const packageRoot = path.join(mutant, "node_modules/virtual-bash");
    const filename = path.join(packageRoot, mutation.file);
    const original = fs.readFileSync(filename, "utf8");
    let changed = original;
    if (mutation.deleteExport) {
      const metadata = JSON.parse(original);
      assert.ok(Object.hasOwn(metadata.exports, mutation.deleteExport));
      delete metadata.exports[mutation.deleteExport];
      changed = JSON.stringify(metadata, null, 2) + "\n";
    } else for (const replacement of mutation.replacements ?? [mutation]) {
      assert.equal(changed.split(replacement.before).length, 2, mutation.id);
      changed = changed.replace(replacement.before, replacement.after);
    }
    fs.writeFileSync(filename, changed);
    result.mutations.push({ ...mutation, original, changed, originalSha256: hash(original), changedSha256: hash(changed) });
    const args = mutation.type ? typeArguments(mutant, mutation.type)
      : ["--unhandled-rejections=strict", "--test", "--test-name-pattern", mutation.pattern, "cohort.mjs"];
    guarded(mutation.id, mutant, args, packageRoot);
    assert.deepEqual(inventory(moved), positiveBefore);
  }
  const guardRoot = path.join(temporary, "guard-controls");
  fs.cpSync(moved, guardRoot, { recursive: true });
  const guardProduct = path.join(guardRoot, "node_modules/virtual-bash");
  const probe = path.join(guardRoot, "probe.mjs");
  const target = path.join(guardProduct, "dist/index.js");
  const original = fs.readFileSync(target);
  fs.writeFileSync(probe, "await import('virtual-bash');");
  guarded("N08-changed", guardRoot, ["probe.mjs"], guardProduct, "installed", { before() { fs.appendFileSync(target, "\n"); }, after() { fs.writeFileSync(target, original); } });
  const unlisted = path.join(guardRoot, "unlisted.mjs");
  fs.writeFileSync(probe, "await import('./unlisted.mjs');");
  guarded("N08-unlisted", guardRoot, ["probe.mjs"], guardProduct, "installed", { before() { fs.writeFileSync(unlisted, "export const value = 1;"); }, after() { fs.unlinkSync(unlisted); } });
  const outside = path.join(repository, "dist/index.js");
  assert.ok(fs.existsSync(outside));
  fs.writeFileSync(probe, `await import(${JSON.stringify(outside)});`);
  guarded("N08-live", guardRoot, ["probe.mjs"], guardProduct);
  assert.deepEqual(inventory(moved), positiveBefore);
  assert.deepEqual(inventory(path.dirname(tooling)), toolsBefore);
  const sourceAfter = inventory(path.join(temporary, "archived-source-not-admitted"));
  for (const name of Object.keys(sourceAfter)) if (name.startsWith("dist/")) delete sourceAfter[name];
  assert.deepEqual(sourceAfter, sourceBefore);
  result.sourcePostInventory = sourceAfter;
  result.completed = true;
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(temporary);
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, failure: result.failure, temporaryRemoved: result.temporaryRemoved }));
}
