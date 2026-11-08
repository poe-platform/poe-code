import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const base = new URL("./evidence-v1/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", base)));
const compressed = Buffer.from(readFileSync(new URL("RAW.json.gz.base64", base), "utf8"), "base64");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(compressed), manifest.compressedSha256);
const payload = gunzipSync(compressed); assert.equal(payload.length, manifest.payloadBytes); assert.equal(digest(payload), manifest.payloadSha256);
const entries = JSON.parse(payload).entries; assert.equal(entries.length, manifest.entries.length);
const decoded = new Map();
for (const [index, entry] of entries.entries()) {
  const bytes = Buffer.from(entry.base64, "base64"), { base64: _bytes, ...metadata } = entry;
  assert.deepEqual(metadata, manifest.entries[index]); assert.equal(bytes.length, entry.bytes); assert.equal(digest(bytes), entry.sha256);
  assert.equal(decoded.has(entry.name), false); decoded.set(entry.name, bytes);
}
const final = JSON.parse(decoded.get("final/REPORT.json")), original = JSON.parse(decoded.get("original-packed-attempt/REPORT.json"));
assert.equal(final.candidate, manifest.candidate); assert.equal(final.tree, manifest.tree); assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
assert.equal(original.status, "fail"); assert.ok(original.failures.length > 0);
assert.deepEqual(final.archiveBefore, final.archiveAfter); assert.deepEqual(final.emittedBefore, final.emitted); assert.deepEqual(final.package.before, final.package.after);
assert.equal(final.package.metadataSha256, manifest.package.metadataSha256); assert.equal(final.package.tarballSha256, manifest.package.tarballSha256);
assert.deepEqual(final.sourceCounts, { tests: 257, pass: 257, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
for (const command of final.commands) assert.equal(command.status, command.expected, command.name);
assert.equal(final.commands.length, 20); assert.equal(final.checks.length, 22); assert.ok(final.checks.every(check => check.status === "pass"));
for (const runtime of [0, 1]) {
  const observation = JSON.parse(decoded.get(`final/runtime-${runtime}-lifecycle.js.json`));
  const lines = observation.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines[0].lifecycle.length, 6); assert.equal(lines[1].loadBindings.length, 194);
  const [body, headers] = lines[0].lifecycle;
  assert.equal(body.callerAborted, false); assert.equal(headers.callerAborted, false);
  assert.equal(body.requestAborted, true); assert.equal(headers.requestAborted, false);
  assert.equal(body.active, 0); assert.equal(headers.active, 0);
}
const receiptBytes = readFileSync(new URL("INDEPENDENT-BINDINGS-BLOCKED.json", base));
assert.equal(digest(receiptBytes), "f4abf562b80e31c1c43962ffc84820c6df8ea443e924adf693f238fca8e764d0");
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.candidateCommit, final.candidate); assert.match(receipt.admission, /^BLOCKED:/u);
assert.equal(receipt.packSha256, final.package.tarballSha256);
assert.equal(Object.keys(receipt.packageFiles).length, 36339); assert.equal(Object.keys(receipt.archiveSymlinks).length, 12);
assert.deepEqual(receipt.packFiles, Object.fromEntries(final.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
for (const input of final.inputBindings) assert.equal(receipt.packageFiles[input.path], input.sha256, input.path);
for (const [path, entry] of Object.entries(receipt.archiveSymlinks)) {
  assert.ok(path.startsWith("tests/commands/filesystem-inspection-stress/tree/"));
  const bytes = Buffer.from(entry.target); assert.equal(digest(bytes), entry.sha256);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.gitBlob);
}
console.log(JSON.stringify({ authenticatedEntries: entries.length, candidate: final.candidate, sourceTests: final.sourceCounts, authorChecks: final.checks.length, scope: "saved author evidence integrity; not independent behavioral acceptance" }));
