import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digest, directory, save } from "./evidence-tools.mjs";

const json = name => JSON.parse(readFileSync(`${directory}/evidence/${name}.json`, "utf8"));
const lines = name => readFileSync(`${directory}/evidence/${name}.stdout.log`, "utf8").split("\n");
const timing = name => lines(name).flatMap(line => { const match = /HARNESS_TIMING (\{.*\})/u.exec(line); return match ? [JSON.parse(match[1])] : []; });
const triples = json("expected-330-triples");
const expected = new Map(triples.map(row => [`${row.id}/${row.route}/${row.transport}`, row.sha256]));
const jq = [];
for (const name of ["baseline-jq-events", "serial-jq", "round-1-jq", "round-2-jq", "round-3-jq"]) {
  const events = timing(name);
  const completed = events.filter(row => row.event === "jq-execute-complete");
  assert.equal(completed.length, 330);
  const seen = new Set();
  for (const { detail } of completed) {
    const key = `${detail.vector}/${detail.route}/${detail.transport}`;
    assert.equal(detail.sha256, expected.get(key), key); assert(!seen.has(key)); seen.add(key);
  }
  const durations = completed.map(row => row.detail.durationMs).sort((left, right) => left - right);
  const processResult = json(name);
  jq.push({ name, exactTriples: completed.length, enteredRead: events.filter(row => row.event === "jq-entered-read").length, firstData: events.filter(row => row.event === "jq-first-data").length, moduleReadyAtMs: events.find(row => row.event === "jq-module-ready")?.atMs, executionMs: { minimum: durations[0], median: durations[165], maximum: durations.at(-1) }, processMs: processResult.durationMs, exitMs: processResult.events.find(row => row.event === "exit")?.ms, closeMs: processResult.events.find(row => row.event === "close")?.ms });
}
const native = [];
for (const name of ["serial-streaming", "round-1-streaming", "round-2-streaming", "round-3-streaming", "final-streaming"]) {
  assert(lines(name).some(line => /# pass 6\b/u.test(line)));
  const events = timing(name);
  const runs = events.filter(row => row.event === "native-delivery").map(row => row.detail);
  assert.equal(runs.length, 3);
  for (const run of runs) {
    const firstData = run.events.find(row => row.event === "stdout-data");
    const suffix = run.events.find(row => row.event === "write" && row.detail.hex.startsWith("00"));
    assert(firstData.ms < suffix.ms);
    assert.equal(run.actualClose, true); assert.equal(run.ownedListenersRemaining, 0); assert.equal(run.activeTimers, 0); assert.deepEqual(run.streamsDestroyed, [true, true, true]);
    native.push({ name, repetition: run.repetition, spawnMs: run.events.find(row => row.event === "spawn").ms, firstDataMs: firstData.ms, suffixMs: suffix.ms, exitMs: run.events.find(row => row.event === "exit").ms, closeMs: run.events.find(row => row.event === "close").ms });
  }
  const firstData = events.filter(row => row.event === "virtual-first-data");
  const suffix = events.filter(row => row.event === "virtual-suffix-after-output");
  assert.equal(firstData.length, 3); assert.equal(suffix.length, 3);
  for (let index = 0; index < 3; index++) assert(firstData[index].atMs < suffix[index].atMs);
}
const frozen = JSON.parse(readFileSync(`${directory}/frozen/manifest.json`, "utf8"));
for (const record of frozen.records) assert.equal(digest(readFileSync(`${directory}/frozen/${record.origin}/${record.path}.txt`)), record.sha256);
const before = json("before"); const after = json("post-final-check");
const sourceChanges = Object.entries(before.hashes).filter(([path, hash]) => path.startsWith("src/") && after.hashes[path] !== hash).map(([path, beforeHash]) => ({ path, before: beforeHash, after: after.hashes[path] }));
const negatives = json("negative-controls-final-detail");
const phaseFailures = negatives.filter(row => row.result).map(row => ({ mutation: row.mutation, failure: row.failure, actualClose: row.result.actualClose, closeObserved: row.result.closeObserved, timers: row.result.events.filter(event => event.event === "timer-fired") }));
assert.equal(phaseFailures.length, 5);
const summary = { frozenRecordsVerified: frozen.records.length, originalFailuresRetained: frozen.failures.length, fullgateRouting: frozen.routing, fullgateSource: frozen.baseline, beforeHead: before.head, afterHead: after.head, startedAt: before.at, checkedAt: after.at, sourceChanges, jq, native, phaseFailures, scheduledCohorts: json("schedule-results"), finalCorrectionCohorts: json("final-check-results") };
save("evidence/summary.json", summary);
console.log(JSON.stringify({ frozenRecordsVerified: summary.frozenRecordsVerified, originalFailuresRetained: summary.originalFailuresRetained, sourceChanges, jq, native, phaseFailures }, null, 2));
