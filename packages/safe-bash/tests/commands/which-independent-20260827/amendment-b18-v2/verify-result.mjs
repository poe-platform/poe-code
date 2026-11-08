import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import path from "node:path";
const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const result = JSON.parse(readFileSync(path.join(own, "RESULT.json"), "utf8"));
const compressed = Buffer.from(readFileSync(path.join(own, "replay-01.json.gz.base64"), "utf8"), "base64");
assert.equal(hash(compressed), result.captureSha256);
const capture = JSON.parse(gunzipSync(compressed));
assert.equal(capture.failure, undefined);
assert.equal(capture.overlayCommit, result.overlayCommit);
assert.equal(capture.reports.length, 3);
assert.equal(capture.reports.find(row => row.label === "scoped-transitive-build").status, 0);
for (const report of capture.reports.filter(row => row.label.startsWith("amended-B18"))) {
  assert.equal(report.status, 0);
  assert.match(report.stdout, /# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  assert.ok(report.args.includes("--test-name-pattern=^B18 "));
  assert.equal(report.loaded.find(entry => entry.filename === path.join(report.cwd, "fixtures/cohort-v1.mjs")).sha256, capture.overlay.effectiveSha256);
  const source = report.layout === "source";
  const prefix = path.join(report.cwd, source ? "src" : "dist") + path.sep;
  for (const entry of report.loaded.filter(row => row.filename.startsWith(prefix))) {
    const relative = entry.filename.slice(prefix.length);
    assert.equal(entry.sha256, source ? capture.sourceHashes[`src/${relative}`] : capture.emittedHashes[relative]);
  }
}
assert.equal(capture.sourceReplay, 0);
assert.equal(capture.movedReplay, 0);
assert.equal(capture.cleanup.removedTaskRoot, true);
assert.deepEqual(result.activeOwnedProcesses, []);
assert.equal(result.all26Rescored, false);
console.log(JSON.stringify({ selectedAmendedB18: { source: "1/1", moved: "1/1" }, originalCohorts: "25/26 retained in both layouts", candidate: capture.revision, all26Rescored: false, publicOrNativeQualification: false }));
