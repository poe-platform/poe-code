import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { hash, repository } from "../inspect.mjs";
import { processes } from "../supervise.mjs";

const scope = "tests/integration/full-gate-20260827/cold-typecheck", evidence = join(scope, "evidence");
const sources = [["/tmp/full-gate-cold-0c8cf15-first", "current-initial"], ["/tmp/full-gate-cold-0c8cf15-current", "current-path-check"], ["/tmp/full-gate-cold-0c8cf15-final", "current-final"], ["/tmp/full-gate-cold-e36-control", "e36-control-initial"], ["/tmp/full-gate-cold-e36-control-final", "e36-control-final"]];
function add(path, bytes) {
  assert.equal(existsSync(path), false);
  const text = bytes.toString("utf8"), encoded = !Buffer.from(text).equals(bytes) || (bytes.length > 0 && !text.endsWith("\n"));
  const filename = path + (encoded ? ".bytes.base64" : ""), content = encoded ? bytes.toString("base64") + "\n" : text;
  const lines = content.length ? content.slice(0, -1).split("\n").map(line => "+" + line).join("\n") + "\n" : "";
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${filename}\n${lines}*** End Patch\n` });
  const written = readFileSync(filename); assert.deepEqual(encoded ? Buffer.from(written.toString().trim(), "base64") : written, bytes);
  return { path: filename, encoding: encoded ? "base64" : "raw", bytes: bytes.length, sha256: hash(bytes) };
}
const captures = [], reports = [];
for (const [root, name] of sources) {
  const report = JSON.parse(readFileSync(join(root, "report.json"))); reports.push(report); assert.equal(report.temporaryRemoved, true); assert.equal(existsSync(report.root), false);
  const walk = directory => { for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), info = lstatSync(path); assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) walk(path); else { assert.ok(info.isFile()); captures.push({ original: path, ...add(join(evidence, nameFor(root), relative(root, path)), readFileSync(path)) }); }
  } };
  const nameFor = path => sources.find(([source]) => source === path)[1]; walk(root);
}
const current = reports[2], control = reports[4];
assert.equal(current.status, "captured"); assert.equal(control.status, "captured");
assert.deepEqual(current.fixtureHashes, control.fixtureHashes); assert.equal(current.originalFixtureSha256, control.originalFixtureSha256);
const revision = current.revision, git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
const changes = git("diff-tree", "--no-commit-id", "--name-only", "-r", revision).trim().split("\n").sort();
assert.deepEqual(changes, ["package.json", "tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json", "tsconfig.json"].sort());
const oldManifest = JSON.parse(git("show", `${revision}^:package.json`)), newManifest = JSON.parse(git("show", `${revision}:package.json`));
const consumerScript = newManifest.scripts["typecheck:consumers"]; delete newManifest.scripts["typecheck:consumers"]; assert.deepEqual(newManifest, oldManifest);
const oldConfig = JSON.parse(git("show", `${revision}^:tsconfig.json`)), newConfig = JSON.parse(git("show", `${revision}:tsconfig.json`));
assert.deepEqual(newConfig.exclude, [...oldConfig.exclude, "tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts"]); newConfig.exclude = oldConfig.exclude; assert.deepEqual(newConfig, oldConfig);
add(join(scope, "patch-scope.json"), Buffer.from(JSON.stringify({ revision, changedPaths: changes, consumerScript, onlyOneExactExclusion: true, existingManifestFieldsAndScriptsUnchanged: true, originalHistoricalFixtureUnchanged: true, currentColdStillFailsTS7053: true, wholeSuiteRerun: false }, null, 2) + "\n"));
add(join(scope, "capture-manifest.json"), Buffer.from(JSON.stringify({ captures }, null, 2) + "\n"));
const observed = [...new Map(reports.flatMap(report => report.phases.flatMap(phase => phase.observed)).map(row => [`${row.pid}:${row.born}`, row])).values()];
const running = processes(), active = observed.filter(row => running.some(current => current.pid === row.pid && current.born === row.born)); assert.deepEqual(active, []);
for (const [root] of sources) rmSync(root, { recursive: true });
add(join(scope, "cleanup.json"), Buffer.from(JSON.stringify({ sealedAt: new Date().toISOString(), observedIdentities: observed.length, active, executionTreesRemoved: reports.every(report => !existsSync(report.root)), exactRemovedCapturePaths: sources.map(([root]) => root), allCaptureRoundtripsVerified: true }, null, 2) + "\n"));
console.log(JSON.stringify({ files: captures.length, originalBytes: captures.reduce((total, row) => total + row.bytes, 0), observed: observed.length, active: active.length }, null, 2));
