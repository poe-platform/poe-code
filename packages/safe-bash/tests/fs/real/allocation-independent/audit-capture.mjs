import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const capture = join(base, "final-01");
const json = path => JSON.parse(readFileSync(join(capture, path), "utf8"));
const text = path => readFileSync(join(capture, path), "utf8");
const digest = data => createHash("sha256").update(data).digest("hex");
const report = json("report.json");
assert.equal(report.candidate, "28cfe0f2cdc9b82c940523fce7d6fc08dacaeb94");
assert.equal(report.verdict, "bounded acceptance");
assert.deepEqual(json("author-before.json"), json("author-after.json"));
assert.deepEqual(json("author-before.json"), json("candidate-inputs.json"));
assert.equal(digest(JSON.stringify(json("archive-inputs.json"))), report.archiveAfterManifestSha256);
assert.deepEqual(report.unexpectedArchiveAdditions, []);
assert.equal(report.packedUnchanged, true);
assert.deepEqual(report.cleanup, { scratchRemoved: true, remainingOwnedWorkRoots: [] });
for (const [path, hash] of Object.entries(report.harnessInputs)) {
  assert.equal(digest(readFileSync(join(capture, "inputs", `${path}.txt`))), hash);
  assert.equal(digest(readFileSync(join(base, path))), hash);
}
const expected = { "author-core": 9, "author-legacy": 42, "author-wrappers": 425,
  "independent-boundary": 3, "packed-runtime": 21 };
for (const [label, count] of Object.entries(expected)) {
  const command = report.commands.find(command => command.label === label);
  assert.equal(command.status, 0);
  assert.equal(command.counts.tests, count);
  assert.equal(command.counts.pass, count);
  assert.equal(command.counts.fail, 0);
  assert.equal(command.counts.skipped, 0);
  assert.equal(command.counts.todo, 0);
  assert.equal(Number(text(`${label}.stdout.txt`).match(/^# tests (\d+)$/m)[1]), count);
}
for (const label of ["source-types", "build", "pack", "packed-types"]) {
  assert.equal(report.commands.find(command => command.label === label).status, 0);
}
const emitted = json("emitted-files.json");
assert.equal(Object.keys(emitted).length, 740);
const loaded = json("loaded-package.json");
assert.equal(Object.keys(loaded).length, 175);
for (const [path, hash] of Object.entries(loaded)) {
  assert.equal(hash, emitted[path]);
  assert.equal(hash, report.publicPackageBefore[path]);
}
const mutationChecks = [];
assert.equal(report.mutants.length, 7);
for (const mutant of report.mutants) {
  const log = text(`mutant-${mutant.name}.stdout.txt`);
  assert.equal((log.match(/^  code: 'ERR_ASSERTION'$/gm) ?? []).length, mutant.counts.fail);
  const loads = text(`mutant-${mutant.name}.loads.jsonl`).trim().split("\n").map(line => JSON.parse(line));
  const changes = [];
  let packageLoads = 0;
  for (const load of loads) {
    const marker = `/mutant-${mutant.name}/node_modules/virtual-bash/`;
    if (!load.path.includes(marker)) continue;
    packageLoads++;
    const path = load.path.split(marker)[1];
    const original = report.publicPackageBefore[path];
    assert.equal(typeof original, "string");
    if (original !== load.sha256) changes.push(path);
    assert.equal(load.sha256, path === mutant.path ? mutant.mutatedSha256 : original);
  }
  assert.equal(packageLoads, 175);
  assert.deepEqual(changes, [mutant.path]);
  mutationChecks.push({ name: mutant.name, loadedPackageModules: packageLoads, changedModules: changes,
    assertionFailures: mutant.counts.fail, passes: mutant.counts.pass });
}
const diagnostics = text("packed-runtime.stdout.txt").split("\n").filter(line => line.startsWith("# {")).map(line => JSON.parse(line.slice(2)));
const native = diagnostics.find(record => record.observations);
assert.equal(native.observations.length, 12);
for (const row of native.observations) assert.equal(row.allocatedBytes, Number(BigInt(row.blocks) * 512n));
console.log(JSON.stringify({ scope: "read-only consistency audit of final-01, not new product execution", candidate: report.candidate,
  counts: expected, emittedFiles: Object.keys(emitted).length, loadedPackageModules: Object.keys(loaded).length,
  nativeRows: native.observations.length, mutationChecks, stableInputs: true, cleanup: report.cleanup }, null, 2));
