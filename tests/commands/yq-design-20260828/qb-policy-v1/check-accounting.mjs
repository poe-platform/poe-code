import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const control = JSON.parse(await readFile(new URL("./controls.json", import.meta.url), "utf8"));
const W = control.window;

function checked(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(label);
  return value;
}

function add(left, right, label) {
  checked(left, label);
  checked(right, label);
  if (right > Number.MAX_SAFE_INTEGER - left) throw new RangeError(label);
  return left + right;
}

function schedule(pending, ordinaryUnits) {
  checked(pending, "pending");
  checked(ordinaryUnits, "ordinaryUnits");
  assert.ok(pending <= W);
  if (ordinaryUnits === 0) return { checkpoints: 0, finalPending: pending, totalCost: 0 };
  const sum = add(pending, ordinaryUnits, "schedule sum");
  const checkpoints = Math.floor((sum - 1) / W);
  const finalPending = sum - checkpoints * W;
  const totalCost = add(ordinaryUnits, checkpoints, "total cost");
  return { checkpoints, finalPending, totalCost };
}

for (const row of control.scheduleRows) {
  assert.deepEqual(schedule(row.pending, row.ordinaryUnits), {
    checkpoints: row.checkpoints,
    finalPending: row.finalPending,
    totalCost: row.totalCost,
  }, row.id);
}

for (const row of control.sequenceRows) {
  const estimate = schedule(row.initialPending, row.estimateUnits);
  assert.equal(estimate.checkpoints, row.estimateCheckpoints, `${row.id}: estimate checkpoints`);
  assert.equal(estimate.finalPending, row.postEstimatePending, `${row.id}: estimate pending`);
  const copy = schedule(estimate.finalPending, row.copyUnits);
  assert.equal(copy.checkpoints, row.copyCheckpoints, `${row.id}: copy checkpoints`);
  assert.equal(copy.totalCost, row.copyTotalCost, `${row.id}: copy total`);
  assert.equal(copy.finalPending, row.finalPending, `${row.id}: final pending`);
}

for (const row of control.payloadRows) {
  const payloadUnits = row.operationBytes.reduce((total, bytes) =>
    add(total, bytes === 0 ? 0 : Math.ceil(checked(bytes, "payload bytes") / 1024), "payload units"), 0);
  const mergedBytes = row.operationBytes.reduce((total, bytes) => add(total, bytes, "merged bytes"), 0);
  const mergedUnits = mergedBytes === 0 ? 0 : Math.ceil(mergedBytes / 1024);
  assert.equal(payloadUnits, row.payloadUnits, `${row.id}: partitioned`);
  assert.equal(mergedUnits, row.mergedUnits, `${row.id}: merged control`);
}

for (const row of control.fragmentRows) {
  let payloadUnits = 0;
  let naivePerFragmentUnits = 0;
  const finalPartialBytes = [];
  for (const fragments of row.operationFragments) {
    let operationBytes = 0;
    let operationUnits = 0;
    for (const fragment of fragments) {
      checked(fragment, "fragment bytes");
      naivePerFragmentUnits += fragment === 0 ? 0 : Math.ceil(fragment / 1024);
      operationBytes = add(operationBytes, fragment, "operation bytes");
      operationUnits = operationBytes === 0 ? 0 : Math.ceil(operationBytes / 1024);
    }
    payloadUnits = add(payloadUnits, operationUnits, "fragment payload units");
    finalPartialBytes.push(operationBytes % 1024);
  }
  assert.equal(payloadUnits, row.payloadUnits, `${row.id}: operation payload units`);
  assert.equal(naivePerFragmentUnits, row.naivePerFragmentUnits, `${row.id}: naive fragment units`);
  assert.deepEqual(finalPartialBytes, row.finalPartialBytes, `${row.id}: partial bytes`);
}

for (const row of control.admissionRows) {
  assert.equal(row.required <= row.remaining, row.admitted, row.id);
}

const abort = control.stateRows.find(row => row.id === "T00");
assert.equal(add(abort.stepsBefore, abort.reserved, "abort reservation"), abort.stepsAfter);
assert.equal(abort.refund, 0);
assert.equal(abort.published, false);

const interleaving = control.stateRows.find(row => row.id === "T01");
assert.equal(interleaving.reservationActive, true);
assert.equal(interleaving.classification, "INTERNAL_MISUSE_REJECTED");

const doubleTick = control.stateRows.find(row => row.id === "T02");
assert.equal(add(doubleTick.reserved, doubleTick.extraBudgetTickCharge, "double tick"), doubleTick.observedBudgetMutation);
assert.notEqual(doubleTick.observedBudgetMutation, doubleTick.reserved);

const overflow = control.stateRows.find(row => row.id === "T03");
assert.throws(() => schedule(overflow.pending, overflow.ordinaryUnits), RangeError);
assert.equal(overflow.classification, "CHECKED_ARITHMETIC_REFUSAL");

const rows = control.scheduleRows.length + control.sequenceRows.length + control.payloadRows.length + control.fragmentRows.length
  + control.admissionRows.length + control.stateRows.length;
assert.equal(rows, 23);
console.log(`synthetic accounting controls: ${rows} rows passed; product/native/reference runs: 0/0/0`);
