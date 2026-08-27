import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const base = new URL("./evidence-v1/", import.meta.url);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", base)));
const compressed = Buffer.from(readFileSync(new URL("RAW.json.gz.base64", base), "utf8"), "base64");
assert.equal(digest(compressed), manifest.compressedSha256);
const payload = gunzipSync(compressed); assert.equal(payload.length, manifest.payloadBytes); assert.equal(digest(payload), manifest.payloadSha256);
const entries = JSON.parse(payload).entries; assert.equal(entries.length, manifest.entries.length);
const decoded = new Map();
for (const [index, entry] of entries.entries()) {
  const bytes = Buffer.from(entry.base64, "base64"), { base64: _bytes, ...metadata } = entry;
  assert.deepEqual(metadata, manifest.entries[index]); assert.equal(bytes.length, entry.bytes); assert.equal(digest(bytes), entry.sha256);
  assert.equal(decoded.has(entry.name), false); decoded.set(entry.name, bytes);
}
const final = JSON.parse(decoded.get("final/REPORT.json"));
const original = JSON.parse(decoded.get("original-packed-attempt/REPORT.json"));
assert.equal(final.candidate, "0895de2dc63014989f23912c3d48f7c4d0d35a47");
assert.equal(final.candidate, manifest.candidate); assert.equal(final.tree, manifest.tree);
assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
assert.equal(original.candidate, "17284b9b21f4081be1117c5c19924a71bbebb9e6");
assert.equal(original.status, "fail"); assert.equal(original.failures.length, 3);
assert.deepEqual(original.sourceCounts, { tests: 157, pass: 156, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(final.sourceCounts, { tests: 166, pass: 166, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(final.archiveBefore, final.archiveAfter); assert.deepEqual(final.emittedBefore, final.emitted); assert.deepEqual(final.package.before, final.package.after);
assert.equal(final.package.tarballSha256, original.package.tarballSha256);
assert.equal(final.package.metadataSha256, manifest.package.metadataSha256); assert.equal(final.package.tarballSha256, manifest.package.tarballSha256);
assert.equal(final.commands.length, 20); assert.equal(final.checks.length, 22);
for (const command of final.commands) {
  assert.equal(command.status, command.expected, command.name);
  const record = JSON.parse(decoded.get(`final/${command.log}`));
  assert.equal(record.status, command.expected); assert.equal(record.signal, null); assert.equal(record.error, undefined);
}
assert.ok(final.checks.every(check => check.status === "pass"));
for (const runtime of [0, 1]) {
  const observation = JSON.parse(decoded.get(`final/runtime-${runtime}-lifecycle.js.json`));
  const lines = observation.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines[0].lifecycle.length, 13); assert.equal(new Set(lines[0].lifecycle).size, 13);
  const loads = new Map(lines[1].loadBindings);
  for (const path of ["dist/index.js", "dist/commands/du/index.js", "dist/commands/du/du.js"]) {
    const expected = final.package.before.find(entry => entry.path === path);
    assert.equal(loads.get(`${final.package.installed}/${path}`), expected.sha256);
  }
  assert.ok(![...loads.keys()].some(path => /\/shell\/cancellation\.js$/u.test(path)));
}
const handoffBytes = readFileSync(new URL("REVIEW-HANDOFF.json", base));
assert.equal(digest(handoffBytes), "1ff91fcf815f57a895bf46d4aeca8e5da488971d918009dbb1d24b356e7f5b8a");
const handoff = JSON.parse(handoffBytes);
assert.equal(handoff.candidateCommit, final.candidate); assert.equal(handoff.rootReplayAuthorization, null);
assert.equal(handoff.package.tarballSha256, final.package.tarballSha256);
assert.deepEqual(handoff.sourceInventory, final.inputBindings.map(({ blob, ...entry }) => ({ ...entry, gitBlob: blob })));
assert.deepEqual(handoff.packageFiles, Object.fromEntries(final.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
assert.equal(Object.keys(handoff.packageFiles).length, 834); assert.equal(Object.keys(handoff.emittedFiles).length, 832);
assert.equal(handoff.sourceInventory.length, 771);
assert.equal(handoff.declared75Inventory.names.length, 75); assert.equal(new Set(handoff.declared75Inventory.names).size, 75);
assert.deepEqual([...handoff.html74Checkpoint.names, "du"].sort(), [...handoff.declared75Inventory.names].sort());
assert.equal(digest(readFileSync(new URL("./POLICY.md", import.meta.url))), handoff.sourcePathsAndPolicy.sha256);
console.log(JSON.stringify({ candidate: final.candidate, authenticatedCaptures: entries.length, sourceTests: final.sourceCounts, authorChecks: final.checks.length, installedFiles: Object.keys(handoff.packageFiles).length, scope: "saved author evidence integrity, not independent behavioral acceptance or a whole gate" }));
