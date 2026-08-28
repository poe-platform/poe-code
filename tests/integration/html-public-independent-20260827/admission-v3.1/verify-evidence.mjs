import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "./recipe/authenticate.mjs";
import { errorRecord, json, readJson } from "./recipe/telemetry.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const output = join(owned, "execution-01");
const summary = readJson(join(output, "SUMMARY.json"));
const checks = [], controls = [];
function check(name, inspect) {
  try { inspect(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: errorRecord(error) }); }
}
let authentication = null;
check("unchanged committed recipe/tools/historical inputs plus added-entry detection", () => { authentication = authenticate(summary.freeze, summary.manifestSha256); });
check("frozen fail-fast denominators, not a control rerun", () => {
  assert.equal(summary.controlsDeclared, 5);
  assert.equal(summary.controlsExecuted, 4);
  assert.equal(summary.expectedOutcomes, 3);
  assert.equal(summary.unexpectedFailures, 1);
  assert.deepEqual(summary.unexecuted, ["allocation-mutant"]);
  assert.equal(summary.postAuthenticated, true);
  assert.equal(readFileSync(join(owned, "execution-01.exit.data"), "utf8"), "1\n");
  assert.equal(summary.actual34, 0);
  assert.equal(summary.extraMaterializerControls, 0);
  assert.equal(summary.full410BuildPackReconstruction, false);
});
check("saved synthetic controls all reached intended predicate, no reevaluation", () => {
  const inputs = readJson(join(output, "SYNTHETIC-INPUTS.json"));
  const result = readJson(join(output, "SYNTHETIC-RESULTS.json"));
  assert.equal(inputs.synthetic, true);
  assert.equal(inputs.inputs.length, 28);
  assert.equal(result.executed, 28);
  assert.equal(result.expectedOutcomes, 28);
  assert.equal(result.allExpected, true);
  assert.equal(result.rows.filter(row => row.actual.accepted).length, 2);
  assert.equal(result.rows.filter(row => !row.actual.accepted).length, 26);
  for (const row of result.rows) {
    assert.equal(row.actual.accepted, row.expectedAccepted);
    assert.equal(row.actual.reason, row.expectedReason);
  }
  assert.deepEqual(summary.synthetic, result);
});
for (const row of summary.rows) {
  const directory = join(output, row.directory);
  const raw = readJson(join(directory, "RAW-RECEIPT.json"));
  const consumer = readJson(join(directory, "consumer.receipt.json"));
  const producer = readJson(join(directory, "producer.receipt.json"));
  const supervisor = readFileSync(join(directory, "supervisor.events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const chronological = supervisor.filter(event => !["memory", "baseline"].includes(event.type));
  controls.push({ control: row.control, verdict: row, started: raw.started, harnessSettlementAt: raw.harnessSettlementAt, elapsedMs: Date.parse(raw.harnessSettlementAt) - Date.parse(raw.started), consumer: { pid: consumer.pid, status: raw.code, signal: raw.signal, memory: consumer.memory, flow: consumer.flow, mutation: consumer.mutation, failure: consumer.failure, result: consumer.result }, producer: { pid: producer.pid, status: producer.status, signal: producer.signal, memory: producer.memory, flow: producer.flow, uncaught: producer.uncaught }, consumerObservation: consumer.consumerObservation, supervisorMemoryExcluded: raw.supervisorMemoryExcluded, chronological, reaping: { closeObserved: raw.closeObserved, consumerState: raw.consumerState, producerState: raw.producerState, membersAtClose: raw.membersAtClose, remainingGroupMembers: raw.remainingGroupMembers }, signalsSent: raw.signalsSent });
  check(`${row.control}: raw receipts and reap-before-assertion evidence`, () => {
    assert.deepEqual(raw.consumer.value, consumer);
    assert.deepEqual(raw.producer.value, producer);
    assert.equal(raw.closeObserved, true);
    assert.equal(raw.consumerState.state, "absent");
    assert.equal(raw.producerState.state, "absent");
    assert.deepEqual(raw.membersAtClose, []);
    assert.deepEqual(raw.remainingGroupMembers, []);
    assert.deepEqual(raw.signalsSent, []);
    assert.equal(raw.assertionState, "not evaluated; all available numeric and process outcomes durable first");
    const receiptIndex = supervisor.findIndex(event => event.type === "received" && event.message.type === "receipt");
    const closeIndex = supervisor.findIndex(event => event.type === "child-close");
    const reapIndex = supervisor.findIndex(event => event.phase === "after-reap");
    assert.ok(receiptIndex >= 0 && receiptIndex < closeIndex && closeIndex < reapIndex);
  });
  for (const [role, receipt] of [["consumer", consumer], ["producer", producer]]) check(`${row.control}/${role}: all five sampled memory fields and peaks`, () => {
    const samples = readFileSync(join(directory, `${role}.samples.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(samples.length, receipt.memory.samples + 1);
    assert.deepEqual(samples[0].memory, receipt.memory.baseline);
    assert.deepEqual(samples.at(-1).memory, receipt.memory.latest);
    for (const field of ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"]) {
      for (const sample of samples) assert.ok(Number.isSafeInteger(sample.memory[field]) && sample.memory[field] >= 0);
      assert.equal(Math.max(...samples.map(sample => sample.memory[field])), receipt.memory.fieldwisePeaks[field]);
    }
    assert.ok(samples.every(sample => sample.pid === receipt.pid));
  });
}
check("positive strict absolute current sampled RSS and complete bytes/hash", () => {
  const positive = controls[0];
  assert.ok(positive.consumer.result.maxRssBytes < 268435456);
  assert.ok(positive.consumer.memory.fieldwisePeaks.rss < 268435456);
  assert.equal(positive.consumer.result.bytes, 1073872896);
  assert.equal(positive.consumer.result.sha256, "f5b4c8bf0f2f882ef51effdb305a5edf1c8c657d05ba2fd7594c679478fe668f");
  assert.equal(positive.producer.flow.writes, 16386);
  assert.equal(positive.producer.flow.falseWrites, positive.producer.flow.drains);
});
check("actual consumer-only structured proof and independently saved receipts", () => {
  const directory = join(output, "03-consumer-failure");
  const actual = controls[2], observation = actual.consumerObservation;
  assert.deepEqual(readJson(join(directory, "CONSUMER-OBSERVATION.json")), observation);
  assert.deepEqual(readJson(join(directory, "CALLER-FAILURE.json")), observation.caller);
  assert.deepEqual(readJson(join(directory, "PRODUCER-UNCAUGHT.json")), actual.producer.uncaught);
  assert.deepEqual(readJson(join(directory, "TERMINAL-PREDICATE.json")), { accepted: true, reason: "structured-closed-consumer-EPIPE", terminal: "exit1/EPIPE" });
  assert.equal(actual.producer.uncaught.stdoutErrorMonitorObserved, true);
  assert.equal(actual.producer.uncaught.stdoutErrorSameObject, true);
  assert.equal(actual.producer.uncaught.error.code, "EPIPE");
  assert.equal(actual.producer.uncaught.error.syscall, "write");
  assert.equal(actual.producer.status, 1);
  assert.equal(actual.consumer.failure.message, observation.caller.message);
  assert.equal(observation.sameFailureObject, true);
  assert.equal(observation.producerAtSettlement, "absent");
  for (let index = 1; index < observation.events.length; index++) assert.ok(BigInt(observation.events[index].monotonicNs) > BigInt(observation.events[index - 1].monotonicNs));
  assert.ok(actual.elapsedMs < 45000);
});
check("strict timeout failure retained; allocation never reached", () => {
  const timeout = controls[3];
  assert.equal(timeout.verdict.outcome, "unexpected-control-failure");
  assert.equal(timeout.consumer.failure.code, "V3_TIMEOUT");
  assert.equal(timeout.producer.status, 1);
  assert.equal(timeout.producer.signal, null);
  assert.equal(timeout.producer.uncaught, null);
  assert.equal(timeout.consumer.flow.chunks, 16);
  assert.ok(timeout.chronological.some(event => event.type === "abort" && event.code === "V3_TIMEOUT"));
  assert.deepEqual(summary.unexecuted, ["allocation-mutant"]);
});
const validation = { at: new Date().toISOString(), scope: "post-run read-only authenticity and saved-numeric consistency checks; no synthetic/actual recipe reevaluation or retry", freeze: summary.freeze, manifestSha256: summary.manifestSha256, authentication, checks, allPassed: checks.every(check => check.passed), controls, admission: "HELD; strict timeout failed and allocation-mutant unexecuted" };
json(join(owned, "VALIDATION.json"), validation);
console.log(JSON.stringify({ checks: checks.length, allPassed: validation.allPassed, freeze: summary.freeze }));
process.exitCode = validation.allPassed ? 0 : 1;
