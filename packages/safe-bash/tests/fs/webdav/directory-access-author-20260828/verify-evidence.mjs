import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const candidate = "ca1d33424b94a21ae0f40a36412fd8191611e2df";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const expected = {
  "admission-00": "bfc78b5c150d727904043f6ed309b94e90b98e238466637c532fb7f9a46a1b7f",
  "baseline-01": "37ca547d69799612d60affe0814b2e282fcb49bf9009510b21c6f788f0acc981",
  "candidate-01": "f70a03e38713c3814f83cfa0831e05506dbe603ad4ce513d6a095963344e716a",
  "candidate-02": "6263789ad5cc090bd373c7b7b2a458f2315bcb87f236eac63286dd0ec6ef4f71",
};
const captures = Object.fromEntries(Object.entries(expected).map(([name, sha256]) => {
  const bytes = Buffer.from(fs.readFileSync(path.join(own, `${name}.json.gz.base64`), "utf8"), "base64");
  assert.equal(hash(bytes), sha256, name);
  return [name, JSON.parse(gunzipSync(bytes))];
}));
assert.equal(captures["admission-00"].exitCode, 1);
const baseline = captures["baseline-01"];
assert.deepEqual(baseline.records.find(record => record.name === "focused").counts,
  { tests: 61, pass: 13, fail: 48, cancelled: 0, skipped: 0, todo: 0 });
const first = captures["candidate-01"];
assert.deepEqual(first.records.find(record => record.name === "provider regression").counts,
  { tests: 568, pass: 562, fail: 6, cancelled: 0, skipped: 0, todo: 0 });
assert.equal(first.records.find(record => record.name === "scoped types").status, 2);
const final = captures["candidate-02"];
assert.equal(final.base, base);
assert.equal(final.independentFreeze, "c65c121e0756390869cddcf78ceb49d0de9cdd2b");
assert.equal(final.failure, undefined);
for (const capture of [baseline, first, final]) {
  assert.equal(capture.temporaryRemoved, true);
  assert.equal(fs.existsSync(capture.root), false);
  assert.equal(hash(gunzipSync(Buffer.from(capture.baseArchiveGzipBase64, "base64"))), capture.baseArchiveSha256);
  assert.deepEqual(capture.sourceAfter, capture.sourceBefore);
  for (const record of capture.records) { assert.equal(record.signal, null); assert.equal(record.error, null); }
  for (const [name, value] of Object.entries(capture.authorInputs)) assert.equal(hash(Buffer.from(value.base64, "base64")), value.sha256, name);
}
const finalSourcePaths = git("ls-tree", "-r", "--name-only", base, "src").toString().trim().split("\n");
assert.deepEqual(Object.keys(final.sourceBefore).sort(), finalSourcePaths.map(name => name.slice(4)).sort());
assert.deepEqual(Object.keys(final.selectedSource).sort(), ["src/fs/webdav/README.md", "src/fs/webdav/webdav.ts"]);
for (const name of finalSourcePaths) {
  const commit = Object.hasOwn(final.selectedSource, name) ? candidate : base;
  assert.equal(hash(git("show", `${commit}:${name}`)), final.sourceBefore[name.slice(4)].sha256, name);
}
assert.deepEqual(final.selectedSource, first.selectedSource);
for (const [name, value] of Object.entries(final.selectedSource)) {
  assert.equal(hash(Buffer.from(value.base64, "base64")), value.sha256);
  assert.equal(hash(git("show", `${candidate}:${name}`)), value.sha256);
  assert.equal(final.liveSourceAfter[name], value.sha256);
}
for (const [name, value] of Object.entries(final.authorInputs)) {
  assert.equal(hash(git("show", `${candidate}:tests/fs/webdav/directory-access-author-20260828/${name}`)), value.sha256, name);
  assert.equal(final.authorInputsAfter[name], value.sha256);
}
assert.deepEqual(final.archivePaths.filter(name => !first.archivePaths.includes(name)).sort(),
  ["tests/fs/webdav/property-fixture.ts", "tests/fs/webdav/real-service/evidence/apache-final/raw.json"]);
for (const [name, value] of Object.entries(final.supplementalTests)) assert.equal(hash(git("show", `${value.commit}:${name}`)), value.sha256);
for (const [name, count] of [["focused", 61], ["provider regression", 680], ["webdav shared conformance", 61], ["shell cd-state-cancellation regression", 108]]) {
  const record = final.records.find(row => row.name === name);
  assert.deepEqual(record.counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, name);
}
assert.equal(final.records.length, 13);
assert.ok(final.records.every(record => record.status === 0));
assert.equal(final.package.sha256, "2f6d9f142165802f4e8a033c317f5c4f034f535508d3a434688e547b654c85b0");
assert.equal(hash(Buffer.from(final.package.base64, "base64")), final.package.sha256);
assert.equal(final.package.sha256, first.package.sha256);
assert.equal(Object.keys(final.packageInventory).length, 846);
for (const layout of final.layouts) {
  assert.equal(layout.runtimeStatus, 0);
  assert.equal(layout.typesStatus, 0);
  assert.deepEqual(layout.after, final.packageInventory);
  assert.equal(new Set(layout.loads.map(row => row.relative)).size, 207);
  assert.ok(layout.loads.some(row => row.relative === "dist/fs/webdav/webdav.js"));
  for (const loaded of layout.loads) assert.equal(loaded.sha256, final.packageInventory[loaded.relative].sha256);
  const publicRecord = final.records.find(record => record.name === `${layout.layout} public`);
  assert.equal(JSON.parse(Buffer.from(publicRecord.stdoutBase64, "base64").toString()).count, 9);
}
console.log(JSON.stringify({ candidate, base, sourceFiles: 2, focused: 61, provider: 680, sharedSelection: 61,
  shellSelection: 108, installed: 9, moved: 9, loadedModulesPerLayout: 207, packedEntries: 846,
  baselineFailures: 48, firstCandidateAdmissionFailures: 6, sourceUnchangedBetweenCandidateRuns: true,
  result: "author evidence authenticated; independent review pending; no provider or test replay" }, null, 2));
