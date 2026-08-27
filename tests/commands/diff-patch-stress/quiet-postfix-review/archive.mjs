import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { differences, git, inventory, location, owned, readJson, repository, save, sha } from "./common.mjs";

const work = readFileSync(location, "utf8").trim(), manifest = readJson(join(work, "manifest.json"));
const first = manifest.captureCompletion.first, initial = readJson(join(first, "manifest.json"));
assert.deepEqual(inventory(initial.oldProfile, ["node_modules"]), manifest.dependencies);
assert.deepEqual(inventory(initial.oldProfile, Object.keys(initial.oldHelpers)), initial.oldHelpers);
assert.equal(sha(readFileSync(process.execPath)), manifest.runtime.executableSha256);
const files = {};
function archive(name, path) {
  const bytes = readFileSync(path), compressed = gzipSync(bytes);
  assert.deepEqual(gunzipSync(compressed), bytes);
  files[name] = { bytes: bytes.length, sha256: sha(bytes), gzipBase64: compressed.toString("base64") };
}
function directory(prefix, root) {
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isDirectory()) directory(`${prefix}/${name}`, path);
    else if (stat.isFile()) archive(`${prefix}/${name}`, path);
  }
}
for (const path of Object.keys(manifest.inputs)) archive(`inputs/${path}`, join(manifest.snapshot, path));
for (const path of Object.keys(initial.oldHelpers)) archive(`original-profile/${path}`, join(initial.oldProfile, path));
for (const [label, root] of [["initial-attempt", first], ["complete-replay", work]]) {
  for (const name of readdirSync(root).sort()) if (lstatSync(join(root, name)).isFile() && /\.json$/u.test(name)) archive(`${label}/${name}`, join(root, name));
  directory(`${label}/logs`, join(root, "logs"));
  directory(`${label}/imports`, join(root, "imports"));
}
directory("historical-census", join(work, "historical"));
const livePaths = Object.keys(manifest.inputs), live = inventory(repository, livePaths);
const drift = differences(manifest.inputs, live);
const currentAllSource = inventory(repository, ["src"]);
const frozenAllSource = inventory(manifest.snapshot, ["src"]);
assert.deepEqual(frozenAllSource, Object.fromEntries(Object.entries(manifest.inputs).filter(([path]) => path.startsWith("src/"))), "source capture omitted an actual frozen path");
const acceptedCurrent = Object.fromEntries(Object.entries(manifest.accepted).map(([path, record]) => [path, { ...record, current: sha(readFileSync(join(repository, path))), stillEqualAccepted: record.expected === sha(readFileSync(join(repository, path))) }]));
const evidenceDrift = drift.filter(row => !row.path.startsWith("src/"));
assert.deepEqual(evidenceDrift, [], "read-only fixtures or helpers changed while running");
const full = readJson(join(work, "full-summary.json")), five = readJson(join(first, "five-summary.json")), validation = readJson(join(work, "validation.json"));
const originalReplay = readJson(join(work, "original-current-replay-full.json"));
const expectedConflicts = readJson(join(manifest.snapshot, "tests/commands/diff-patch-stress/gnu-revised-full-review/delta-audit.json")).changedNamedTests;
assert.deepEqual(originalReplay.suites.flatMap(suite => suite.failures.map(failure => failure.name)).sort(), [...expectedConflicts].sort());
assert.deepEqual(full.cohorts[0].totals, { tests: 3758, pass: 3758, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
assert.deepEqual(full.cohorts[1].totals, { tests: 3758, pass: 3750, fail: 8, skipped: 0, cancelled: 0, todo: 0 });
const result = { capturedAt: new Date().toISOString(), headAtFreeze: manifest.head, headAtArchive: git("rev-parse", "HEAD").toString().trim(), frozenSourceAggregate: manifest.sourceAggregate, liveSourceAggregate: sha(JSON.stringify(currentAllSource)), sourceDrift: differences(frozenAllSource, currentAllSource), otherInputDrift: evidenceDrift, acceptedCurrent, five, full, validation: { scopedNoEmit: validation.scoped.status, isolatedBuild: validation.build.status, outputAggregate: validation.buildOutputAggregate, wholeRepositoryNoEmitRun: false }, initialCaptureFailure: manifest.captureCompletion, ownership: { directory: owned, productionEdited: false, existingTestsEdited: false, benchmarksEdited: false, historicalEvidenceEdited: false, dependenciesAdded: false, unrelatedNativeArtifactsTouched: false, tableCorpusRun: false, newTools: false, rootDistEmission: false, workersClosedNormally: true, signalsSentByVerifier: false }, archive: { members: Object.keys(files).length, uncompressedBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0), gzipPayloadBytes: Object.values(files).reduce((sum, file) => sum + Buffer.from(file.gzipBase64, "base64").length, 0), excludes: ["native executable binaries", "native temporary fixture trees", "node_modules binaries (manifest only)", "generated build binaries (manifest only)"] } };
save(join(repository, owned, "EVIDENCE.json"), { encoding: "gzip/base64 per member; all SHA-256 hashes checked before serialization", files });
save(join(repository, owned, "RESULT.json"), result);
save(join(repository, owned, "FIVE.json"), { corrected: readJson(join(first, "corrected-current-five.json")), originalCurrentReplay: readJson(join(first, "original-current-replay-five.json")), delta: five.delta });
save(join(repository, owned, "FULL.json"), full);
save(join(repository, owned, "VALIDATION.json"), validation);
const archiveBytes = readFileSync(join(repository, owned, "EVIDENCE.json"));
const decoded = JSON.parse(archiveBytes);
for (const member of Object.values(decoded.files)) {
  const bytes = gunzipSync(Buffer.from(member.gzipBase64, "base64"));
  assert.equal(bytes.length, member.bytes);
  assert.equal(sha(bytes), member.sha256);
}
save(join(repository, owned, "ARCHIVE-CHECK.json"), { ...result.archive, sha256: sha(archiveBytes), checkedMembers: Object.keys(decoded.files).length, passed: true });
console.log(JSON.stringify({ ...result.validation, full: full.cohorts, five: five.results, archive: result.archive, sourceDrift: result.sourceDrift.map(row => row.path), acceptedStillExact: Object.values(acceptedCurrent).every(record => record.stillEqualAccepted) }, null, 2));
