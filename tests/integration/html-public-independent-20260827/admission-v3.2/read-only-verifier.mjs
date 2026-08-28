import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { intactBindings } from "./recipe/bindings.mjs";
import { inventory, readJson, fileHash } from "./recipe/telemetry.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "execution-01");
const launch = readJson(join(root, "LAUNCH-START.json"));
const launchResult = readJson(join(root, "LAUNCH-RESULT.json"));
const checks = [];
function check(name, action) {
  try { action(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
let authentication;
check("frozen recipe, tools, immutable history and all 78 live prior files", () => { authentication = intactBindings(launch.freeze, launch.manifestSha256); });
const summary = readJson(join(output, "SUMMARY.json"));
check("summary is bound to the exact sole launch", () => {
  assert.equal(summary.freeze, launch.freeze);
  assert.equal(summary.manifestSha256, launch.manifestSha256);
  assert.equal(launch.invocation, 1);
  assert.equal(launchResult.invocation, 1);
  assert.equal(launchResult.retry, false);
});
function journalConsistency(directory, role, snapshot) {
  const rows = readFileSync(join(directory, `${role}.samples.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const baseline = rows.find(row => row.type === "baseline").memory;
  const samples = rows.filter(row => row.type === "memory");
  const peaks = { ...baseline };
  for (const row of samples) for (const field of Object.keys(peaks)) peaks[field] = Math.max(peaks[field], row.memory[field]);
  assert.deepEqual(snapshot.baseline, baseline);
  assert.deepEqual(snapshot.fieldwisePeaks, peaks);
  assert.deepEqual(snapshot.latest, samples.at(-1).memory);
  assert.equal(snapshot.samples, samples.length);
}
for (const row of summary.rows) {
  const directory = join(output, row.directory);
  const raw = readJson(join(directory, "RAW-RECEIPT.json"));
  check(`${row.control}: saved verdict and safety unchanged in summary`, () => {
    assert.equal(readJson(join(directory, "VERDICT.json")).outcome, row.outcome);
    assert.deepEqual(readJson(join(directory, "SAFETY.json")), row.safety);
  });
  check(`${row.control}: receipt copies match exact persisted numeric records`, () => {
    assert.deepEqual(raw.consumer.value, readJson(join(directory, "consumer.receipt.json")));
    assert.deepEqual(raw.producer.value, readJson(join(directory, "producer.receipt.json")));
  });
  check(`${row.control}: saved output hashes`, () => {
    assert.equal(fileHash(join(directory, "stdout.data")), raw.outputHashes.stdout);
    assert.equal(fileHash(join(directory, "stderr.data")), raw.outputHashes.stderr);
  });
  for (const role of ["consumer", "producer"]) check(`${row.control}: ${role} journal-to-receipt fieldwise consistency`, () => journalConsistency(directory, role, raw[role].value.memory));
  check(`${row.control}: read-only binding attestation provenance`, () => {
    const saved = readJson(join(directory, "BINDINGS.json"));
    assert.equal(saved.authentication?.freeze, launch.freeze);
    assert.equal(saved.authentication?.manifestSha256, launch.manifestSha256);
    assert.equal(saved.authentication?.oldLiveFilesAuthenticated, 78);
  });
}
check("forwarding and synthetic saved results match summary without predicate execution", () => {
  assert.deepEqual(readJson(join(output, "forwarding-controls", "SUMMARY.json")), summary.forwarding);
  assert.deepEqual(readJson(join(output, "SYNTHETIC-RESULTS.json")), summary.synthetic);
});
const runtimeInventory = inventory(output);
console.log(JSON.stringify({ at: new Date().toISOString(), mode: "read-only integrity and numeric consistency; no control execution or predicate rescoring", checks, passed: checks.filter(row => row.passed).length, failed: checks.filter(row => !row.passed).length, launchExitCode: launchResult.exitCode, savedOutcomes: summary.rows.map(row => ({ control: row.control, outcome: row.outcome })), runtimeInventory, authentication }, null, 2));
process.exitCode = checks.some(row => !row.passed) ? 1 : 0;
