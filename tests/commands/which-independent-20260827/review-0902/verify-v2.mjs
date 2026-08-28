import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = JSON.parse(readFileSync(path.join(own, "REVIEW.json"), "utf8"));
for (const [filename, digest] of Object.entries({ ...seal.evidenceHashes, ...seal.harnessHashes })) assert.equal(hash(readFileSync(path.join(own, filename))), digest, filename);
const readCapture = name => JSON.parse(gunzipSync(Buffer.from(readFileSync(path.join(own, name), "utf8"), "base64")));
const initial = readCapture("initial-01.json.gz.base64");
const diagnostic = readCapture("diagnostic-02.json.gz.base64");
const historical = readCapture("initial-harness.json.gz.base64");
for (const [filename, encoded] of Object.entries(historical.files)) assert.equal(hash(Buffer.from(encoded, "base64")), initial.evidenceInputs[filename]);
for (const record of [initial, diagnostic]) {
  assert.equal(record.revision, seal.candidate);
  assert.equal(record.freeze, seal.fixtureFreeze);
  assert.equal(hash(Buffer.from(record.archiveBase64, "base64")), record.archiveSha256);
  assert.equal(record.cleanup.removedTaskRoot, true);
  assert.equal(record.failure, undefined);
  for (const [filename, digest] of Object.entries(record.sourceHashes)) {
    const bytes = execFileSync("git", ["--no-replace-objects", "show", `${record.revision}:${filename}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(hash(bytes), digest, filename);
  }
  for (const report of record.reports.filter(row => row.label.startsWith("unchanged-frozen"))) {
    assert.equal(report.status, 1);
    assert.match(report.stdout, /# pass 25\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0/);
    assert.deepEqual(report.stdout.split("\n").filter(line => line.startsWith("not ok ")).map(line => line.split(" - ")[1]), ["B18 actual Shell module-only integration"]);
    assert.equal(report.authenticatedProduct, 170);
    const source = report.layout === "source";
    const prefix = path.join(report.cwd, source ? "src" : "dist") + path.sep;
    const loaded = report.loaded.filter(entry => entry.filename.startsWith(prefix));
    for (const entry of loaded) assert.equal(entry.sha256, source ? record.sourceHashes[`src/${entry.filename.slice(prefix.length)}`] : record.emittedHashes[entry.filename.slice(prefix.length)]);
    for (const filename of ["commands/which/index", "commands/which/options", "commands/which/which"]) assert.ok(loaded.some(entry => entry.filename === prefix + filename + (source ? ".ts" : ".js")));
  }
  for (const report of record.reports.filter(row => /^(source-built|moved)-T0[1-4]$/.test(row.label))) assert.equal(report.status, 0);
  assert.equal(record.reports.filter(row => /^(source-built|moved)-T0[1-4]$/.test(row.label)).length, 8);
  for (const mutation of record.mutations) {
    assert.notEqual(mutation.status, 0);
    if (mutation.id !== "M08") assert.equal(mutation.assertionRejection, true);
    else assert.match(record.reports.find(row => row.label.startsWith("M08-")).stdout, /Forbidden which operation: stdin/);
  }
  assert.equal(record.mutations.length, 8);
  assert.equal(record.typeMutation.unusedExpectError, true);
  assert.equal(record.guardControls.length, 3);
  for (const control of record.guardControls) assert.equal(control.rejected, true);
  assert.deepEqual(record.postcheck, { originalSourceBytesUnchanged: true, sourceEntrySetUnchanged: true, emittedEntrySetAndBytesUnchanged: true, toolingEntrySetAndBytesUnchanged: true });
}
for (const report of diagnostic.reports.filter(row => row.label.startsWith("postfreeze"))) {
  assert.equal(report.status, 0);
  assert.match(report.stdout, /# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/);
  const line = report.stdout.split("\n").find(line => line.startsWith("# WHICH_POSTFREEZE_TRANSCRIPT="));
  const transcript = JSON.parse(line.slice("# WHICH_POSTFREEZE_TRANSCRIPT=".length).replace(/\\([\\#])/g, "$1"));
  const original = transcript.find(row => row.id === "P01");
  assert.equal(original.stderr, seal.B18.actualStderr);
  assert.equal(original.dispatches, 0);
  const changed = transcript.find(row => row.id === "P02");
  assert.equal(changed.exitCode, 1);
  assert.equal(changed.stdout, "/a/tool\n");
  assert.equal(changed.dispatches, 1);
}
assert.equal(seal.B18.amendmentApplied, false);
assert.equal(seal.cleanup.allAbsent, true);
assert.deepEqual(seal.cleanup.activeOwnedProcesses, []);
console.log(JSON.stringify({ verification: "stored hashes/results only; no new candidate or native execution", candidate: seal.candidate, originalRuntimePerLayout: "25/26", typeFamiliesPerLayout: "4/4", supplementaryPerLayout: "6/6", runtimeMutantsRejected: 8, typeMutantsRejected: 1, loaderViolationsRejected: 3, originalFreezeChanged: false }, null, 2));
