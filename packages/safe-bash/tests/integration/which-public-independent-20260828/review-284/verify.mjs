import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(fs.readFileSync(path.join(own, "REVIEW.json"), "utf8"));
for (const [name, expected] of Object.entries(report.files)) assert.equal(hash(fs.readFileSync(path.join(own, name))), expected, name);
const compressed = Buffer.from(fs.readFileSync(path.join(own, report.evidence.filename), "utf8"), "base64");
assert.equal(hash(compressed), report.evidence.compressedSha256);
const capture = JSON.parse(gunzipSync(compressed));
assert.equal(capture.candidate, "284857d7aa9b0ee0df2b6fdd1a71f41115d7b909");
assert.equal(capture.rootSource, "ee1f69e721e350fcc77d634b92e5c9f13f61dedb");
assert.equal(capture.fixtureHashes["cohort.mjs"], "46ed767896a6da884dbbe379ed5d2d0e5d8ff53fdb138f3ba4ad5b68377ad8aa");
for (const [name, expected] of Object.entries(capture.fixtureHashes)) assert.equal(hash(fs.readFileSync(path.join(own, "..", name))), expected);
for (const [name, bytes] of Object.entries(capture.fixtureBytes)) assert.equal(hash(Buffer.from(bytes, "base64")), capture.fixtureHashes[name]);
assert.equal(hash(Buffer.from(capture.archiveBase64, "base64")), capture.archiveSha256);
assert.equal(hash(Buffer.from(capture.package.base64, "base64")), "49191d098e1e9f5b946f24dd898377144062110047cf6975d3cbf5d2c71214c0");
assert.equal(capture.package.metadata.entryCount, 846);
assert.equal(Object.keys(capture.sourceHashes).length, 265);
assert.equal(Object.keys(capture.emittedInventory).length, 844);
assert.deepEqual(capture.sourceInventory, capture.sourcePostInventory);
assert.equal(capture.completed, true);
assert.equal(capture.temporaryRemoved, true);
const counts = stdout => Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
for (const record of capture.records) {
  assert.equal(record.signal, null);
  assert.equal(record.error, undefined);
  assert.equal(record.directChildGone, true);
}
for (const [label, layout] of Object.entries(capture.layouts)) {
  assert.deepEqual(layout.before, layout.after);
  assert.equal(layout.loadedProduct.length, 206);
  const runtime = capture.records.find(row => row.label === `${label}-runtime18`);
  assert.equal(runtime.status, 0);
  assert.deepEqual(counts(runtime.stdout), { tests: 18, pass: 18, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const types = capture.records.filter(row => row.label.startsWith(`${label}-T`));
  assert.equal(types.length, 4);
  for (const family of types) { assert.equal(family.status, 0); assert.doesNotMatch(family.stdout + family.stderr, /error TS\d+/); }
  const packageRoot = path.join(capture.temporary, label === "installed" ? "installed" : "physically-moved", "node_modules/virtual-bash");
  for (const filename of layout.loadedProduct) assert.ok(filename.startsWith(path.join(packageRoot, "dist") + path.sep));
  for (const entry of runtime.loads.filter(row => row.filename.startsWith(packageRoot + path.sep))) {
    assert.equal(entry.sha256, capture.emittedInventory[path.relative(path.join(packageRoot, "dist"), entry.filename)].sha256);
  }
  assert.equal(runtime.loads.some(row => row.filename.startsWith(path.join(capture.temporary, "source") + path.sep)), false);
}
for (const id of ["N01", "N03", "N04", "N05", "N06"]) {
  const record = capture.records.find(row => row.label === id);
  assert.equal(record.status, 1);
  assert.deepEqual(counts(record.stdout), { tests: 1, pass: 0, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  assert.match(record.stdout, /ERR_ASSERTION/);
  assert.doesNotMatch(record.stdout + record.stderr, /PUBLIC_WHICH_UNLISTED|PUBLIC_WHICH_CHANGED|ERR_MODULE_NOT_FOUND|ERR_TEST_TIMEOUT/);
}
const exportControl = capture.records.find(row => row.label === "N02");
assert.equal(exportControl.status, 1);
assert.match(exportControl.stdout + exportControl.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
const typeControl = capture.records.find(row => row.label === "N07");
assert.equal(typeControl.status, 2);
assert.deepEqual([...typeControl.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]), ["TS2344", "TS2322", "TS2578", "TS2578"]);
for (const id of ["N08-changed", "N08-unlisted", "N08-live"]) {
  const record = capture.records.find(row => row.label === id);
  assert.equal(record.status, 1);
  assert.match(record.stderr, id === "N08-changed" ? /PUBLIC_WHICH_CHANGED:/ : /PUBLIC_WHICH_UNLISTED:/);
}
for (const mutation of capture.mutations) {
  assert.equal(hash(mutation.original), mutation.originalSha256);
  assert.equal(hash(mutation.changed), mutation.changedSha256);
  assert.notEqual(mutation.originalSha256, mutation.changedSha256);
}
assert.deepEqual(report.cleanup.remainingOwnedRootProcesses, []);
console.log(JSON.stringify({ verified: true, candidate: capture.candidate, installed: "18/18 + 4 types", moved: "18/18 + 4 types", negativeClasses: 8, wholeGateAccepted: false, nativeWhichRuns: 0 }));
