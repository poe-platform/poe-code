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
const result = { classification: "independent bounded WHICH candidate review; no native/public/default qualification",
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
  fs.copyFileSync(path.join(own, "guard.mjs"), guard);
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
  fs.copyFileSync(path.join(own, "controls.mjs"), path.join(snapshot, "fixtures/controls.mjs"));
  const sourceReport = runtime("unchanged-frozen-source", snapshot, "source");
  result.sourceReplay = sourceReport.status;
  runtime("postfreeze-source-controls", snapshot, "source", undefined, { entry: "controls.mjs" });
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
  const movedReport = runtime("unchanged-frozen-moved", moved, "moved");
  result.movedReplay = movedReport.status;
  runtime("postfreeze-moved-controls", moved, "moved", undefined, { entry: "controls.mjs" });
  const typeFixtures = JSON.parse(fs.readFileSync(path.join(snapshot, "fixtures/types-v1.json"), "utf8"));
  for (const [layout, root] of [["source-built", snapshot], ["moved", moved]]) for (const fixture of typeFixtures.families) {
    const filename = path.join(root, `${fixture.id}.mts`);
    patch(filename, fixture.source);
    run(`${layout}-${fixture.id}`, [path.join(tooling, "typescript/bin/tsc"), ...typeFixtures.compilerOptions, "--listFiles", filename], root);
  }
  const plan = JSON.parse(fs.readFileSync(path.join(own, "negative-plan.json"), "utf8"));
  result.mutations = [];
  const mutant = path.join(scratch, "mutant");
  fs.mkdirSync(mutant);
  fs.cpSync(path.join(moved, "dist"), path.join(mutant, "dist"), { recursive: true });
  fs.cpSync(path.join(moved, "fixtures"), path.join(mutant, "fixtures"), { recursive: true });
  fs.copyFileSync(path.join(moved, "package.json"), path.join(mutant, "package.json"));
  fs.symlinkSync(tooling, path.join(mutant, "node_modules"), "dir");
  const implementation = path.join(mutant, "dist/commands/which/which.js");
  const original = fs.readFileSync(implementation, "utf8");
  for (const mutation of plan.productMutations) {
    assert.equal(original.split(mutation.old).length, 2, `${mutation.id}: mutation binding must be unique`);
    const changed = original.replace(mutation.old, mutation.new);
    fs.writeFileSync(implementation, changed);
    const report = runtime(`${mutation.id}-${mutation.name}`, mutant, "moved", mutation.target);
    result.mutations.push({ ...mutation, beforeSha256: hash(original), afterSha256: hash(changed), status: report.status,
      assertionRejection: report.status !== 0 && /ERR_ASSERTION/.test(report.stdout + report.stderr) && !/WHICH_GUARD_|MODULE_NOT_FOUND|SyntaxError/.test(report.stdout + report.stderr) });
    fs.writeFileSync(implementation, original);
  }
  const declaration = path.join(mutant, plan.typeMutation.file);
  const originalDeclaration = fs.readFileSync(declaration, "utf8");
  assert.equal(originalDeclaration.split(plan.typeMutation.old).length, 2);
  const changedDeclaration = originalDeclaration.replace(plan.typeMutation.old, plan.typeMutation.new);
  fs.writeFileSync(declaration, changedDeclaration);
  patch(path.join(mutant, "T03.mts"), typeFixtures.families.find(fixture => fixture.id === "T03").source);
  const typeMutation = run("TM01-weak-probe-type", [path.join(tooling, "typescript/bin/tsc"), ...typeFixtures.compilerOptions, "T03.mts"], mutant);
  result.typeMutation = { ...plan.typeMutation, beforeSha256: hash(originalDeclaration), afterSha256: hash(changedDeclaration), status: typeMutation.status,
    unusedExpectError: /TS2578/.test(typeMutation.stdout) };
  fs.writeFileSync(declaration, originalDeclaration);
  const guardTamper = runtime("G01-post-manifest-tamper", mutant, "moved", "B01", { afterManifest() { fs.writeFileSync(implementation, original + "\n"); } });
  fs.writeFileSync(implementation, original);
  const liveUrl = new URL(`file://${path.join(repository, "src/commands/which/which.ts")}`).href;
  const liveControl = runtime("G02-live-source-denied", mutant, "moved", undefined, { eval: `await import(${JSON.stringify(liveUrl)})` });
  const unlisted = path.join(scratch, "unlisted.mjs");
  patch(unlisted, "throw new Error('UNLISTED_EXECUTED');\n");
  const newControl = runtime("G03-unlisted-scratch-denied", mutant, "moved", undefined, { eval: `await import(${JSON.stringify(new URL(`file://${unlisted}`).href)})` });
  result.guardControls = [
    { id: "G01", rejected: /WHICH_GUARD_HASH/.test(guardTamper.stdout + guardTamper.stderr) },
    { id: "G02", rejected: /WHICH_GUARD_UNLISTED/.test(liveControl.stdout + liveControl.stderr) },
    { id: "G03", rejected: /WHICH_GUARD_UNLISTED/.test(newControl.stdout + newControl.stderr) && !/Error: UNLISTED_EXECUTED/.test(newControl.stderr) }
  ];
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
