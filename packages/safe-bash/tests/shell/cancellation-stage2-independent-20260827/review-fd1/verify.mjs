import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const summary = JSON.parse(fs.readFileSync(path.join(own, "REVIEW.json"), "utf8"));
for (const [name, expected] of Object.entries(summary.files)) assert.equal(hash(fs.readFileSync(path.join(own, name))), expected, name);
const captures = Object.fromEntries(Object.entries(summary.evidence).map(([name, entry]) => {
  const compressed = Buffer.from(fs.readFileSync(path.join(own, `${name}.json.gz.base64`), "utf8"), "base64");
  assert.equal(hash(compressed), entry.compressedSha256);
  const capture = JSON.parse(gunzipSync(compressed));
  assert.equal(capture.completed, true);
  assert.equal(capture.temporaryRemoved, true);
  for (const record of capture.records) {
    assert.equal(record.error, undefined);
    assert.equal(record.signal, null);
  }
  return [name, capture];
}));
const counts = stdout => Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
const expected = total => ({ tests: total, pass: total, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
const current = captures["focused-02"];
assert.equal(current.candidate, "fd1daa123298568546d9ea4e95f8c81dde9c52ff");
assert.equal(current.archiveSha256, "51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87");
assert.equal(hash(Buffer.from(current.archiveBase64, "base64")), current.archiveSha256);
assert.equal(hash(current.effectiveCohort), "b6ff804f0397907930fb41cbe17eb8bd4caf60a4edc2b424341aa80c1c204b7f");
assert.equal(hash(Buffer.from(current.package.base64, "base64")), current.package.sha256);
assert.equal(current.package.sha256, "87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af");
for (const capture of [captures["focused-01"], current]) {
  assert.deepEqual(capture.sourcePostInventory, capture.sourceInventory);
  for (const [label, layout] of Object.entries(capture.layouts)) {
    assert.deepEqual(layout.before, layout.after);
    assert.equal(layout.loadedProduct.length, 204);
    const record = capture.records.find(row => row.label === `${label}-runtime26`);
    assert.equal(record.status, 0);
    assert.deepEqual(counts(record.stdout), expected(26));
    const types = capture.records.filter(row => row.label.startsWith(`${label}-T`));
    assert.equal(types.length, 8);
    for (const family of types) { assert.equal(family.status, 0); assert.doesNotMatch(family.stdout + family.stderr, /error TS\d+/); }
    const base = label === "source" ? "source" : label === "installed" ? "installed/node_modules/virtual-bash" : "relocated-package-consumer/node_modules/virtual-bash";
    const prefix = path.join(capture.temporary, base, label === "source" ? "src" : "dist") + path.sep;
    for (const filename of layout.loadedProduct) assert.ok(filename.startsWith(prefix), filename);
    for (const entry of layout.loads.filter(row => row.filename.startsWith(prefix))) {
      const relative = entry.filename.slice(prefix.length);
      const admitted = label === "source" ? capture.sourceInventory[`src/${relative}`] : capture.emittedInventory[relative];
      assert.equal(entry.sha256, admitted.sha256);
    }
  }
  for (const label of ["build", "pack", "install-offline"]) assert.equal(capture.records.find(row => row.label === label).status, 0);
}
for (const label of ["installed", "moved"]) {
  const record = current.records.find(row => row.label === `${label}-public-resolution`);
  assert.equal(record.status, 0);
  assert.equal(JSON.parse(record.stdout).resolved, current.layouts[label].moduleUrl);
  assert.doesNotMatch(record.stdout, /\/source\//);
}
const controls = captures["controls-01"];
for (const id of summary.controls.originalRuntimeMutantsRejected) {
  const record = controls.records.find(row => row.label === id);
  assert.equal(record.status, 1);
  assert.equal(counts(record.stdout).fail, 1);
  assert.equal(counts(record.stdout).cancelled, 0);
  assert.equal(counts(record.stdout).skipped, 0);
  assert.doesNotMatch(record.stdout + record.stderr, /ERR_MODULE_NOT_FOUND|STAGE2_GUARD_|TransformError|ERR_TEST_TIMEOUT/);
}
assert.deepEqual(counts(controls.records.find(row => row.label === "M05").stdout), expected(2));
const typeMutation = controls.records.find(row => row.label === "M10");
assert.equal(typeMutation.status, 2);
assert.deepEqual([...typeMutation.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]), ["TS2578"]);
for (const label of summary.controls.loaderControlsRejected) {
  const record = controls.records.find(row => row.label === label);
  assert.equal(record.status, 1);
  assert.match(record.stderr, label === "G01-changed" ? /STAGE2_GUARD_HASH:/ : /STAGE2_GUARD_UNLISTED:/);
}
const supplemental = captures["controls-supplement-02"];
assert.deepEqual(counts(supplemental.records.find(row => row.label === "supplement-positive").stdout), expected(2));
const mutantSupplement = supplemental.records.find(row => row.label === "M05-supplement");
assert.deepEqual(counts(mutantSupplement.stdout), { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
assert.match(mutantSupplement.stdout, /not ok 1 - S01/);
assert.match(mutantSupplement.stdout, /ok 2 - S02/);
const originalRegression = captures["regressions-01"].records.find(row => row.label === "maintained-invoke-cleanup-env-getopts");
assert.equal(originalRegression.status, 1);
assert.equal(counts(originalRegression.stdout).pass, 279);
assert.equal(counts(originalRegression.stdout).fail, 1);
assert.match(originalRegression.stdout, /ENOENT.*phase1-before.json/);
for (const [label, total] of [["maintained-invoke-cleanup-env-getopts", 280], ["maintained-core-owned-output", 39], ["additional-runtime-state-descriptors", 68]]) {
  const record = captures["regressions-02"].records.find(row => row.label === label);
  assert.equal(record.status, 0);
  assert.deepEqual(counts(record.stdout), expected(total));
}
for (const [name, bytes] of Object.entries(captures["regressions-01"].testInputs)) assert.equal(captures["regressions-02"].testInputs[name], bytes);
assert.deepEqual(summary.initialRegressionFailure.addedBaselineFiles.sort(), [
  "tests/shell/getopts/evidence/native-cohort.mjs", "tests/shell/getopts/evidence/phase1-before.json", "tests/shell/getopts/evidence/verify.mjs",
]);
assert.equal(hash(fs.readFileSync(path.join(own, "../baseline.data.json.gz"))), "cfdc64a565c516836c4b7dfc7b25c802fb6a91b3321b3343bf4c24723fbf6b36");
assert.equal(hash(fs.readFileSync(path.join(own, "../baseline-v2.data.json.gz"))), "b0c351e37ae57b55784dc8a69ac11172e444d220267aa9b73669874158b6ed0a");
assert.deepEqual(summary.processCheck.matches, []);
console.log(JSON.stringify({ verified: true, candidate: summary.candidate, runtimePerLayout: "26/26", typeFamiliesPerLayout: "6/6 + 2 controls", regressions: "280 + 39 + 68", originalM05SurvivorPreserved: true, originalBaselineHistoryPreserved: true }));
