import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const own = dirname(import.meta.filename);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await readFile(join(own, path), "utf8"));
const rows = [];
for (const [label, expected] of Object.entries({
  "exact-failed": [[13, 12, 1]],
  "current-before": [[13, 12, 1], [19, 3, 16]],
  "candidate-final": [[13, 13, 0], [19, 19, 0], [23, 23, 0], [5, 5, 0]],
  "current-head": [[13, 13, 0], [19, 19, 0], [23, 23, 0], [5, 5, 0]],
})) {
  const summary = await json(`evidence/${label}/summary.json`);
  assert.equal(summary.failure, undefined);
  assert.equal(summary.cleanup.removed, true);
  assert.deepEqual(summary.results.map(result => [result.counts.tests, result.counts.pass, result.counts.fail]), expected);
  for (const result of summary.results) {
    assert.equal(result.counts.cancelled + result.counts.skipped + result.counts.todo, 0);
    assert.equal(result.status, result.counts.fail ? 1 : 0);
  }
  assert.deepEqual(await json(`evidence/${label}/protected-before.json`), await json(`evidence/${label}/protected-after.json`));
  const baseline = await json(`evidence/${label}/baseline.json`);
  for (const [path, hash] of Object.entries(baseline.harnessHashes)) assert.equal(sha(await readFile(join(own, path))), hash);
  const commands = await json(`evidence/${label}/commands.json`);
  assert.ok(commands.filter(command => !summary.results.some(result => result.name === command.name)).every(command => command.status === 0));
  if (summary.profile === "candidate") assert.deepEqual(summary.mutantKills, ["MUTANT_KILLED omit-readback", "MUTANT_KILLED nonpersisting", "MUTANT_KILLED mask-eagain"]);
  rows.push({ label, source: summary.source, results: summary.results, mutantKills: summary.mutantKills, loadedModuleCounts: summary.loadedModuleCounts });
}
const historical = await json("evidence/candidate-final/protected-before.json");
const retainedHistorical = Object.keys(historical).filter(path => path.startsWith("tests/fs/webdav/release-timestamp/evidence/"));
for (const path of retainedHistorical) assert.equal(sha(await readFile(join(own, "../../../..", path))), historical[path]);
const artifacts = {};
async function visit(directory) {
  for (const entry of await readdir(join(own, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else artifacts[path] = sha(await readFile(join(own, path)));
  }
}
await visit("evidence");
const entries = await readdir(own);
assert.ok(!entries.some(name => name.startsWith(".work-")));
for (const path of ["run.mjs", "seal.mjs", "closure-loader.mjs", "independent.test.mts", "README.md", "REPORT.md", ".gitignore"]) artifacts[path] = sha(await readFile(join(own, path)));
const seal = { timestamp: new Date().toISOString(), movingHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: own, encoding: "utf8" }).trim(),
  scope: "bounded independent WebDAV helper456 acceptance; historical failures remain failures", rows,
  preservedHistoricalRawFiles: retainedHistorical.length, cleanup: "no owned .work-* directories", artifacts };
await writeFile(join(own, "SEAL.json"), JSON.stringify(seal, null, 2) + "\n");
console.log(JSON.stringify({ rows: rows.length, sealedFiles: Object.keys(artifacts).length, preservedHistoricalRawFiles: retainedHistorical.length, cleanup: seal.cleanup }, null, 2));
