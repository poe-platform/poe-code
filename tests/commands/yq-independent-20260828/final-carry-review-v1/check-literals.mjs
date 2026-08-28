import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "/Users/kjopek/Workspace/safe-bash";
const git = (...arguments_) => execFileSync("git", arguments_, { cwd: root, maxBuffer: 2097152 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const predicates = JSON.parse(readFileSync(new URL("PREDICATES.json", import.meta.url)));
const sealed = predicates.priorIndependent;
const casesBytes = git("show", `${sealed.commit}:${sealed.casesPath}`);
const sourcesBytes = git("show", `${sealed.commit}:${sealed.sourcesPath}`);
assert.equal(hash(casesBytes), sealed.casesSha256);
assert.equal(hash(sourcesBytes), sealed.sourcesSha256);
const cases = JSON.parse(casesBytes);
const sources = JSON.parse(sourcesBytes);
for (const [group, count] of Object.entries(sealed.rowGroups)) assert.equal(cases[group].length, count, group);
assert.equal(Object.values(sealed.rowGroups).reduce((sum, count) => sum + count, 0), 64);
assert.equal(sources.entries.length, 20);
for (const source of sources.entries) {
  const bytes = git("show", `${source.revision}:${source.path}`);
  assert.equal(hash(bytes), source.sha256, source.path);
  assert.equal(bytes.length, source.bytes, source.path);
  assert.equal(git("rev-parse", `${source.revision}:${source.path}`).toString().trim(), source.gitBlob, source.path);
}

function plan(pending, units) {
  const maximum = Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > 1023) throw new RangeError("pending");
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError("units");
  if (units === 0) return { checkpoints: 0, finalPending: pending, cost: 0 };
  if (units > maximum - pending) throw new RangeError("sum");
  const sum = pending + units;
  const checkpoints = Math.floor((sum - 1) / 1023);
  if (checkpoints > maximum - units) throw new RangeError("total");
  return { checkpoints, finalPending: sum - checkpoints * 1023, cost: units + checkpoints };
}
function enumerate(pending, units) {
  assert.ok(units <= 2048);
  let checkpoints = 0;
  for (let index = 0; index < units; index++) {
    if (pending === 1023) { checkpoints++; pending = 0; }
    pending++;
  }
  return { checkpoints, finalPending: pending, cost: units + checkpoints };
}
const scheduleById = new Map(cases.scheduleRows.map(row => [row.id, row]));
for (const row of cases.scheduleRows) {
  const expected = { checkpoints: row.checkpoints, finalPending: row.finalPending, cost: row.cost };
  assert.deepEqual(plan(row.pending, row.units), expected, row.id);
  assert.deepEqual(enumerate(row.pending, row.units), expected, row.id);
}
for (const row of cases.sequenceRows) {
  const estimate = plan(row.pending, row.estimateUnits);
  const copy = plan(estimate.finalPending, row.copyUnits);
  assert.equal(estimate.cost, row.estimateCost, row.id);
  assert.equal(estimate.finalPending, row.postEstimatePending, row.id);
  assert.equal(copy.cost, row.copyCost, row.id);
  assert.equal(copy.finalPending, row.finalPending, row.id);
  assert.equal(estimate.cost + copy.cost, row.combinedCost, row.id);
}
for (const row of cases.admissionRows) assert.equal(scheduleById.get(row.schedule).cost <= row.remaining, row.beforeNextAdmits, row.id);
for (const row of cases.refusalRows) assert.throws(() => plan(row.pending, row.units), error => error instanceof RangeError && error.message === row.stage, row.id);
const terminal = plan(1022, 1);
assert.deepEqual(terminal, { checkpoints: 0, finalPending: 1023, cost: 1 });
assert.equal(terminal.cost <= 1, true);
assert.equal(plan(terminal.finalPending, 1).cost, 2);
assert.deepEqual(plan(1023, 0), { checkpoints: 0, finalPending: 1023, cost: 0 });
assert.equal(predicates.carry.terminalFlush, false);
assert.equal(predicates.carry.noFollowingOwnedUnitOwesTick, false);
for (const row of cases.traceRows) {
  assert.equal(row.expect.refund, 0, row.id);
  assert.equal(typeof row.expect.outcome, "string", row.id);
}
const traces = new Map(cases.traceRows.map(row => [row.id, row]));
assert.equal(traces.get("T06").expect.allocation, false);
assert.equal(traces.get("T07").expect.publication, false);
assert.equal(traces.get("T10").expect.interleaving, false);
console.log(JSON.stringify({
  status: "CHOSEN_CARRY_LITERAL_CHECKS_PASS_NOT_RUNTIME",
  authenticatedPriorRecords: 64,
  authenticatedPriorSourceBindings: 20,
  comparedScheduleRows: 16,
  comparedSequenceRows: 5,
  comparedChosenAdmissionRows: 8,
  comparedRefusalRows: 9,
  prospectiveTraceSchemaRecords: 12,
  closeComparisonHistoryUnchanged: true,
  rootChoice: "CARRY",
  terminalAndEmptyCarryBoundaries: "pass",
  productExecutions: 0,
  runtimeCancellationTests: 0,
}, null, 2));
