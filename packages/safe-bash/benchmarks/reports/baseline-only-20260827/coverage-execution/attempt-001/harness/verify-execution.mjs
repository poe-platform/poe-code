import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cases, diagnostics } from "./execution-cases.mjs";
import { owned, setup, json, hash, publish } from "./audit-common.mjs";
import { assess } from "./assess.mjs";

const preparation = json(`${owned}/prepared-inputs.json`);
assert.equal(hash(readFileSync(`${owned}/prepared-inputs.json`)), "2520e7c15cee5e760c9cb883aeb89ac9793176b21203b206e27420c8b7571915");
assert.equal(hash(readFileSync(`${owned}/prepared-matrix.json`)), "861db0797f752f6d8865a1dae6a6c38abcfa821d5a6d5469c4a371655e4f2fd7");
assert.equal(preparation.productExecutions, 0);
assert.equal(cases.length, 61);
assert.equal(diagnostics.length, 5);
const inventory = json(`${setup}/inventory.json`);
assert.equal(inventory.rows.length, 53);
assert.equal(inventory.addedOptional.length, 4);
assert.deepEqual(cases.filter(specimen => specimen.cohort === "historical-unmeasured").map(specimen => specimen.name).sort(), [...inventory.exactDefaultUnmeasuredNames].sort());
assert.equal(new Set([...cases, ...diagnostics].map(specimen => specimen.id)).size, 66);
for (const specimen of diagnostics) assert.equal(specimen.operationalCredit, false);
for (const name of ["help", "node", "wait"]) assert.equal(cases.find(specimen => specimen.name === name).operationalCredit, false);
const empty = { entries: [], complete: true, errors: [] };
const sleep = cases.find(specimen => specimen.name === "sleep");
const fakeCapture = { exitCode: 0, signal: null, parentTimeout: false, report: { engine: "baseline", captureErrors: [], before: empty, after: empty, productElapsedMs: 0, result: { exitCode: 0, stdout: "", stderr: "", stdoutBase64: "", stderrBase64: "" } } };
assert.equal(assess(sleep, fakeCapture).operationalCredit, false);
fakeCapture.report.productElapsedMs = 20;
assert.equal(assess(sleep, fakeCapture).operationalCredit, true);
fakeCapture.report.result = { exitCode: 127, stdout: "", stderr: "bash: sleep: command not found\n", stdoutBase64: "", stderrBase64: Buffer.from("bash: sleep: command not found\n").toString("base64") };
assert.equal(assess(sleep, fakeCapture).classification, "missing-handler");
fakeCapture.report.result.stderr = "bash: pushd: command not found\n";
assert.equal(assess(cases.find(specimen => specimen.name === "dirs"), fakeCapture).classification, "dependency-blocked");
for (const filename of readdirSync(owned).filter(name => name.endsWith(".mjs"))) execFileSync(process.execPath, ["--check", `${owned}/${filename}`]);
const destination = process.argv[2];
if (destination) {
  const inputs = json(`${destination}/execution-inputs.json`);
  const results = json(`${destination}/results.json`);
  const freeze = json(`${destination}/freeze.json`);
  assert.equal(freeze.inputsSha256, hash(readFileSync(`${destination}/execution-inputs.json`)));
  assert.equal(freeze.manifestSha256, hash(readFileSync(`${destination}/manifest.json`)));
  for (const specimen of [...inputs.cases, ...inputs.diagnostics]) {
    const { inputSha256, ...effective } = specimen;
    assert.equal(hash(JSON.stringify(effective)), inputSha256);
    for (const engine of ["ours", "baseline"]) {
      const raw = json(`${destination}/raw/${specimen.id}.${engine}.json`);
      assert.equal(raw.caseId, specimen.id);
      assert.equal(raw.engine, engine);
      assert.deepEqual(assess(specimen, raw), raw.assessment);
      assert.equal(raw.exitCode, 0);
      assert.equal(raw.signal, null);
      assert.equal(raw.parentTimeout, false);
    }
  }
  assert.equal(results.counts.actualEngineAttempts, 132);
  assert.equal(results.counts.actualProductExecCalls, 132);
  assert.equal(results.counts.normalChildren, 132);
  for (const name of ["snapshotUnchanged", "dependenciesUnchanged", "harnessUnchanged", "runtimeExecutableUnchanged", "allObservedLoadedFilesMatchedFreeze"]) assert.equal(results.integrity[name], true, name);
  const matrix = json(`${destination}/matrix.json`);
  assert.deepEqual(matrix.rows.map(row => row.originalInventoryRow), inventory.rows);
  assert.deepEqual(matrix.additionalOptional.map(row => row.originalInventoryRow), inventory.addedOptional);
  assert.ok(results.observations.every(row => !row.bothPositive || row.ours.operationalCredit && row.baseline.operationalCredit));
  publish(`${destination}/verification.json`, { verifiedAt: new Date().toISOString(), counts: results.counts, staticAssertions: "pass", allRawAssessmentsRecomputed: true, initialPreparationUnchanged: true, allChildrenNormal: true, manifestAndCaseHashes: "pass", retainedHistoricalRows: 53, retainedOptionalRows: 4, integrity: results.integrity });
}
console.log("PASS declaration/schema/assessment controls and syntax; no product invocations by this verifier");
