import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.dirname(own);
const repository = path.resolve(own, "../../../..");
const revision = "0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b";
const freeze = "c5cf2abb49cf7fc0e7ac990ea913617a501cf3ba";
const outputLabel = process.argv[2];
assert.match(outputLabel ?? "", /^[a-z0-9-]+$/, "Unique explicit capture label required");
const output = path.join(own, `${outputLabel}.json.gz.base64`);
assert.equal(fs.existsSync(output), false, "Evidence is immutable");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const patch = (filename, text) => {
  assert.equal(fs.existsSync(filename), false, `Refuse existing generated file: ${filename}`);
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${filename}\n${text.replace(/\n$/, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
};
const tree = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.isSymbolicLink()) {
    assert.equal(entry.name, "node_modules", "Only explicit copied-tooling links are admitted");
    return [];
  }
  return entry.isDirectory() ? tree(path.join(directory, entry.name)) : [path.join(directory, entry.name)];
});
const hashes = directory => Object.fromEntries(tree(directory).map(filename => [path.relative(directory, filename), hash(fs.readFileSync(filename))]));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "which-independent-0902-")));
const snapshot = path.join(scratch, "snapshot");
const moved = path.join(scratch, "moved");
const tooling = path.join(scratch, "tooling", "node_modules");
const reports = [];
const result = { classification: "root-approved selected B18 amendment replay only; no all26 rescore or public/default qualification",
  revision, freeze, startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  nodeBinarySha256: hash(fs.readFileSync(process.execPath)), scratch, reports, fixtureHashes: {}, sourceHashes: {}, tools: {},
  evidenceInputs: Object.fromEntries(tree(own).filter(filename => !filename.endsWith(".base64")).map(filename => [path.relative(own, filename), hash(fs.readFileSync(filename))])), nativeRuns: 0 };
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch,
  LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1" };
let phaseCounter = 0;
const run = (label, args, cwd, extraEnv = {}) => {
  const started = performance.now();
  const child = spawnSync(process.execPath, args, { cwd, env: { ...environment, ...extraEnv }, encoding: "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
  const report = { label, args, cwd, status: child.status, signal: child.signal, error: child.error?.message,
    stdout: child.stdout, stderr: child.stderr, durationMs: Math.round(performance.now() - started) };
  reports.push(report);
  console.log(JSON.stringify({ label, status: report.status, signal: report.signal, durationMs: report.durationMs }));
  assert.equal(child.error, undefined, `${label}: child execution error`);
  assert.equal(child.signal, null, `${label}: child killed`);
  return report;
};
const runtime = (label, root, mode, filter, overrides = {}) => {
  const phase = path.join(scratch, `phase-${++phaseCounter}`);
  fs.mkdirSync(phase);
  const logs = path.join(phase, "loads");
  fs.mkdirSync(logs);
  const manifest = {};
  for (const directory of [root, tooling]) for (const filename of tree(directory)) manifest[fs.realpathSync(filename)] = hash(fs.readFileSync(filename));
  const guard = path.join(phase, "guard.mjs");
  fs.writeFileSync(guard, git("show", "ea7e6cf31636779226455c89b09a617e7b5459a0:tests/commands/which-independent-20260827/review-0902/guard.mjs"));
  manifest[guard] = hash(fs.readFileSync(guard));
  const configuration = { hashes: manifest, logs, ...(mode === "source" ? { sourceRoot: root } : {}) };
  const manifestFile = path.join(phase, "manifest.json");
  patch(manifestFile, JSON.stringify(configuration));
  overrides.afterManifest?.();
  const args = ["--unhandled-rejections=strict", "--import", guard];
  if (mode === "source") args.push("--import", path.join(tooling, "tsx/dist/loader.mjs"));
  if (overrides.eval) args.push("--input-type=module", "-e", overrides.eval);
  else args.push("--test", "--test-concurrency=1", ...(filter ? [`--test-name-pattern=${filter}`] : []), path.join(root, "fixtures", overrides.entry ?? "cohort-v1.mjs"));
  const report = run(label, args, root, { WHICH_CANDIDATE_ROOT: root, WHICH_GUARD_MANIFEST: manifestFile });
  report.layout = mode;
  report.manifestSha256 = hash(fs.readFileSync(manifestFile));
  report.loaded = fs.readdirSync(logs).flatMap(filename => fs.readFileSync(path.join(logs, filename), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  for (const entry of report.loaded) assert.equal(entry.sha256, manifest[entry.filename]);
  report.loadedUnique = [...new Set(report.loaded.map(entry => entry.filename))].length;
  report.authenticatedProduct = [...new Set(report.loaded.filter(entry => entry.filename.startsWith(path.join(root, mode === "source" ? "src" : "dist") + path.sep)).map(entry => entry.filename))].length;
  return report;
};
try {
  const sourceNames = git("ls-tree", "-r", "--name-only", revision, "src").toString().trim().split("\n").filter(filename => filename.endsWith(".ts"));
  const inputNames = [...sourceNames, "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const archive = git("archive", "--format=tar.gz", revision, ...inputNames);
  result.archiveSha256 = hash(archive);
  result.archiveBase64 = archive.toString("base64");
  fs.mkdirSync(snapshot);
  const extraction = spawnSync("tar", ["-xz", "-C", snapshot], { input: archive });
  assert.equal(extraction.status, 0);
  result.sourceHashes = hashes(snapshot);
  for (const name of inputNames) assert.equal(result.sourceHashes[name], hash(git("show", `${revision}:${name}`)), name);
  result.originalInputNames = inputNames;
  for (const name of ["tsx", "esbuild", `@esbuild/${process.platform}-${process.arch}`, "typescript", "@types/node", "undici-types"]) {
    const target = path.join(tooling, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(repository, "node_modules", name), target, { recursive: true, dereference: true });
    result.tools[name] = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).version;
  }
  result.toolHashes = hashes(tooling);
  fs.symlinkSync(tooling, path.join(snapshot, "node_modules"), "dir");
  fs.mkdirSync(path.join(snapshot, "fixtures"));
  for (const name of ["cohort-v1.mjs", "cases-v1.json", "types-v1.json", "FREEZE-v1.json"]) {
    const relative = path.relative(repository, path.join(fixtureDirectory, name));
    const bytes = git("show", `${freeze}:${relative}`);
    assert.deepEqual(bytes, fs.readFileSync(path.join(fixtureDirectory, name)));
    result.fixtureHashes[name] = hash(bytes);
    fs.writeFileSync(path.join(snapshot, "fixtures", name), bytes);
  }
  const overlayCommit = "5194b7579ebc090d737d59f78793afeff9774976";
  const overlay = JSON.parse(git("show", overlayCommit + ":tests/commands/which-independent-20260827/amendment-b18-v2/OVERLAY.json"));
  result.overlayCommit = overlayCommit;
  result.overlay = overlay;
  const fixtureFile = path.join(snapshot, "fixtures/cohort-v1.mjs");
  const originalFixture = fs.readFileSync(fixtureFile, "utf8");
  assert.equal(hash(originalFixture), overlay.baseSha256);
  assert.equal(originalFixture.split(overlay.replacement.before).length, 2);
  const amendedFixture = originalFixture.replace(overlay.replacement.before, overlay.replacement.after);
  assert.equal(hash(amendedFixture), overlay.effectiveSha256);
  fs.writeFileSync(fixtureFile, amendedFixture);
  const sourceReport = runtime("amended-B18-source", snapshot, "source", "^B18 ");
  result.sourceReplay = sourceReport.status;
  const config = { extends: "./tsconfig.build.json", compilerOptions: { noEmitOnError: true },
    files: ["src/commands/which/index.ts", "src/fs/memory/index.ts", "src/fs/readonly/index.ts", "src/shell/shell.ts", "src/plugins/index.ts"], include: [], exclude: [] };
  patch(path.join(snapshot, "tsconfig.review.json"), JSON.stringify(config));
  const build = run("scoped-transitive-build", [path.join(tooling, "typescript/bin/tsc"), "-p", "tsconfig.review.json", "--listFiles"], snapshot);
  assert.equal(build.status, 0, "Scoped build failed: preserved, no foreign fixes");
  result.emittedHashes = hashes(path.join(snapshot, "dist"));
  fs.mkdirSync(moved);
  fs.cpSync(path.join(snapshot, "dist"), path.join(moved, "dist"), { recursive: true });
  fs.cpSync(path.join(snapshot, "fixtures"), path.join(moved, "fixtures"), { recursive: true });
  fs.copyFileSync(path.join(snapshot, "package.json"), path.join(moved, "package.json"));
  fs.symlinkSync(tooling, path.join(moved, "node_modules"), "dir");
  assert.equal(fs.existsSync(path.join(moved, "src")), false);
  const movedReport = runtime("amended-B18-moved", moved, "moved", "^B18 ");
  result.movedReplay = movedReport.status;
  for (const root of [snapshot, moved]) {
    assert.equal(hash(fs.readFileSync(path.join(root, "fixtures/cohort-v1.mjs"))), overlay.effectiveSha256);
    for (const name of ["cases-v1.json", "types-v1.json", "FREEZE-v1.json"]) assert.equal(hash(fs.readFileSync(path.join(root, "fixtures", name))), result.fixtureHashes[name]);
  }
  assert.equal(sourceReport.status, 0);
  assert.equal(movedReport.status, 0);
  for (const report of [sourceReport, movedReport]) {
    assert.match(report.stdout, /# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
    assert.equal(report.loaded.find(entry => entry.filename === path.join(report.cwd, "fixtures/cohort-v1.mjs")).sha256, overlay.effectiveSha256);
  }
  for (const filename of inputNames) assert.equal(hash(fs.readFileSync(path.join(snapshot, filename))), result.sourceHashes[filename]);
  assert.deepEqual(tree(path.join(snapshot, "src")).map(filename => path.relative(snapshot, filename)).sort(), sourceNames.sort(), "No appended source entries");
  assert.deepEqual(hashes(path.join(snapshot, "dist")), result.emittedHashes);
  assert.deepEqual(hashes(path.join(moved, "dist")), result.emittedHashes);
  assert.deepEqual(hashes(tooling), result.toolHashes);
  result.postcheck = { originalSourceBytesUnchanged: true, sourceEntrySetUnchanged: true, emittedEntrySetAndBytesUnchanged: true, toolingEntrySetAndBytesUnchanged: true };
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  result.cleanup = { removedTaskRoot: !fs.existsSync(scratch), persistentChildrenStarted: false };
  result.completedAt = new Date().toISOString();
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  patch(output, bytes.toString("base64") + "\n");
  console.log(JSON.stringify({ output, sha256: hash(bytes), sourceStatus: result.sourceReplay, movedStatus: result.movedReplay, failure: result.failure?.message, cleanup: result.cleanup }));
}
