import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const base = new URL("./evidence-v1/", import.meta.url);
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
const record = name => JSON.parse(decoded.get(name));
const final = record("final/REPORT.json"), initial = record("initial/REPORT.json"), middle = record("synchronous-receipt-attempt/REPORT.json");
assert.equal(final.candidate, "44f00bf84278e3361b52106478d59c707ab7b2bc");
assert.equal(final.candidate, manifest.candidate); assert.equal(final.tree, manifest.tree);
assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
assert.equal(initial.candidate, "2ef03d91d4200558ff3101fc4b070c19b10583a0"); assert.equal(initial.status, "fail"); assert.equal(initial.failures.length, 3);
assert.equal(middle.candidate, "ddef5ec213c42bf234ebb7b5b451568f8fac795a"); assert.equal(middle.status, "fail"); assert.equal(middle.failures.length, 2);
assert.deepEqual(initial.sourceCounts, { tests: 74, pass: 72, fail: 2, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(final.sourceCounts, { tests: 74, pass: 74, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(middle.sourceCounts, final.sourceCounts);
assert.match(record("synchronous-receipt-attempt/installed-1-public.mjs.json").stderr, /EAGAIN/u);
assert.deepEqual(final.archiveBefore, final.archiveAfter); assert.deepEqual(final.emittedBefore, final.emittedAfter); assert.deepEqual(final.package.before, final.package.after);
assert.equal(final.package.tarballSha256, initial.package.tarballSha256); assert.equal(final.package.tarballSha256, middle.package.tarballSha256);
assert.equal(final.package.metadataSha256, manifest.package.metadataSha256); assert.equal(final.package.tarballSha256, manifest.package.tarballSha256);
assert.equal(final.commands.length, 32); assert.equal(final.checks.length, 35); assert.ok(final.checks.every(check => check.status === "pass"));
for (const command of final.commands) {
  assert.equal(command.status, command.expected, command.name);
  const raw = record(`final/${command.name}.json`); assert.equal(raw.status, command.expected); assert.equal(raw.signal, null); assert.equal(raw.error, undefined);
}
let publicWorkers = 0;
for (const phase of ["installed", "moved"]) for (const runtime of [0, 1]) {
  const raw = record(`final/${phase}-${runtime}-public.mjs.json`), lines = raw.stdout.trim().split("\n").map(line => JSON.parse(line));
  const observation = lines.find(line => line.authorPublicCases), loads = new Map(lines.find(line => line.loadBindings).loadBindings);
  assert.equal(observation.authorPublicCases.length, 12); assert.equal(new Set(observation.authorPublicCases.map(value => value.name)).size, 12);
  assert.equal(observation.observer.workers.length, 11); assert.ok(observation.observer.workers.every(worker => worker.closed)); publicWorkers += observation.observer.workers.length;
  assert.equal(loads.size, 205); assert.ok(![...loads.keys()].some(path => path.endsWith("/shell/cancellation.js")));
  const guard = final.guards.find(entry => entry.phase === phase);
  for (const [path, hash] of loads) assert.equal(hash, guard.expected[path]);
  for (const worker of observation.observer.workers) {
    assert.equal(worker.originalSha256, final.package.before.find(entry => entry.path === "dist/commands/regex-execution/worker.js").sha256);
    assert.ok(worker.loads.length > 0); for (const loaded of worker.loads) assert.equal(loaded.sha256, guard.expected[loaded.path]);
  }
}
const handoff = JSON.parse(readFileSync(new URL("REVIEW-HANDOFF.json", base)));
assert.equal(handoff.candidateCommit, final.candidate); assert.equal(handoff.package.tarballSha256, final.package.tarballSha256);
assert.deepEqual(handoff.sourceInventory, final.inputs);
assert.equal(handoff.sourceInventory.length, 357); assert.equal(Object.keys(handoff.packageFiles).length, 834); assert.equal(Object.keys(handoff.emittedFiles).length, 832);
assert.deepEqual(handoff.packageFiles, Object.fromEntries(final.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
assert.deepEqual(handoff.emittedFiles, Object.fromEntries(final.emittedBefore.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
assert.equal(handoff.declared76Inventory.names.length, 76); assert.equal(new Set(handoff.declared76Inventory.names).size, 76);
assert.deepEqual([...handoff.declared76Inventory.baseline75Names, "expr"].sort(), [...handoff.declared76Inventory.names].sort());
assert.equal(digest(readFileSync(new URL("./POLICY.md", import.meta.url))), handoff.sourcePathsAndPolicy.sha256);
assert.equal(handoff.engineBindings.length, 9); for (const binding of handoff.engineBindings) assert.equal(final.inputs.find(entry => entry.path === binding.path).sha256, binding.sha256);
console.log(JSON.stringify({ candidate: final.candidate, authenticatedCaptures: entries.length, source: final.sourceCounts, authorPublicWorkersRetired: publicWorkers, installedFiles: 834, emittedFiles: 832, scope: "saved author evidence integrity, not independent acceptance" }));
