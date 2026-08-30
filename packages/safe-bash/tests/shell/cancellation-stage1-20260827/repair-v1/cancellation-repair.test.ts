import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import {
  admitChildCancellation,
  createRootCancellationLink,
  selectCancellationOutcome,
  subscribeCancellation,
} from "../../../../src/shell/cancellation.js";
import type {
  CancellationAdmissionSnapshot,
  CancellationBoundary,
  CancellationReport,
  CapturedCancellationOutcome,
} from "../../../../src/shell/cancellation.js";

function bounds(depth: number, resourceLimit = 24): CancellationAdmissionSnapshot {
  return { depth, maxDepth: 16, resourceLimit };
}

function root(input: {
  callerSignal?: AbortSignal | undefined;
  controls?: readonly { role: "budget-control" | "pipeline-control"; signal: AbortSignal }[] | undefined;
} = {}): CancellationBoundary {
  return createRootCancellationLink({ admission: bounds(0), ...input });
}

function caught(operation: () => unknown): { readonly threw: boolean; readonly reason: unknown } {
  try {
    operation();
    return { threw: false, reason: undefined };
  } catch (reason) {
    return { threw: true, reason };
  }
}

function returned<Value>(value: Value): CapturedCancellationOutcome<Value> {
  return { kind: "return", value };
}

function thrown(reason: unknown, report?: CancellationReport): CapturedCancellationOutcome<never> {
  return report === undefined ? { kind: "throw", reason } : { kind: "throw", reason, report };
}

test("R01 detached snapshot entry does not truncate fanout", () => {
  const parent = root();
  const local = new AbortController();
  const boundary = admitChildCancellation(parent, { signal: local.signal }, bounds(1));
  const seen: string[] = [];
  let detachB = (): void => { throw new Error("B detacher not initialized"); };
  subscribeCancellation(boundary, () => {
    seen.push("A");
    detachB();
  });
  detachB = subscribeCancellation(boundary, () => { seen.push("B"); });
  subscribeCancellation(boundary, () => { seen.push("C"); });

  local.abort({ marker: "local" });

  assert.deepEqual(seen, ["A", "C"]);
  assert.deepEqual(boundary.close().failures, []);
  parent.close();
});

test("R02 close still stops fanout and naturally finalizes exact failures", () => {
  const parent = root();
  const local = new AbortController();
  const boundary = admitChildCancellation(parent, { signal: local.signal }, bounds(1));
  const callbackFailure = { marker: "callback-failure" };
  const seen: string[] = [];
  subscribeCancellation(boundary, () => {
    seen.push("failure");
    throw callbackFailure;
  });
  let closeFromCallback: ReturnType<CancellationBoundary["close"]> | undefined;
  subscribeCancellation(boundary, () => {
    seen.push("close");
    closeFromCallback = boundary.close();
  });
  subscribeCancellation(boundary, () => { seen.push("must-not-run"); });

  local.abort({ marker: "local" });

  assert.deepEqual(seen, ["failure", "close"]);
  assert.strictEqual(boundary.close(), closeFromCallback);
  assert.deepEqual(closeFromCallback?.failures, [callbackFailure]);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  parent.close();
});

test("R03 admission uses observed first-delivered control and skips getter", () => {
  const configuredFirst = new AbortController();
  const deliveredFirst = new AbortController();
  const boundary = root({ controls: [
    { role: "budget-control", signal: configuredFirst.signal },
    { role: "pipeline-control", signal: deliveredFirst.signal },
  ] });
  const reasonB = { marker: "delivered-B" };
  const reasonA = { marker: "configured-A" };
  deliveredFirst.abort(reasonB);
  configuredFirst.abort(reasonA);
  let reads = 0;

  const failure = caught(() => admitChildCancellation(boundary, {
    get signal() { reads++; return undefined; },
  }));

  assert.equal(failure.threw, true);
  assert.strictEqual(failure.reason, reasonB);
  assert.equal(reads, 0);
  assert.strictEqual(boundary.deliverySignal.reason, reasonB);
  boundary.close();
});

test("R04 ancestor ranking remains separate from immutable delivery and preserves provenance", () => {
  const caller = new AbortController();
  const control = new AbortController();
  const parent = root({
    callerSignal: caller.signal,
    controls: [{ role: "pipeline-control", signal: control.signal }],
  });
  const invoke = new AbortController();
  const child = admitChildCancellation(parent, { signal: invoke.signal }, bounds(1));
  const controlReason = { marker: "control-first" };
  const invokeReason = { marker: "outer-invoke" };
  const callerReason = { marker: "root-caller" };
  control.abort(controlReason);
  invoke.abort(invokeReason);

  assert.strictEqual(child.deliverySignal.reason, controlReason);
  const invokeSelection = selectCancellationOutcome(child, returned(7));
  assert.equal(invokeSelection.outcome.kind, "throw");
  if (invokeSelection.outcome.kind === "throw") assert.strictEqual(invokeSelection.outcome.reason, invokeReason);
  assert.strictEqual(invokeSelection.report?.origin.signal, invoke.signal);
  assert.strictEqual(invokeSelection.report?.origin.frame, child);
  const invokeAdmission = caught(() => admitChildCancellation(child, { signal: undefined }));
  assert.equal(invokeAdmission.threw, true);
  assert.strictEqual(invokeAdmission.reason, invokeReason);

  caller.abort(callerReason);
  assert.strictEqual(child.deliverySignal.reason, controlReason);
  const callerSelection = selectCancellationOutcome(child, thrown(invokeReason, invokeSelection.report));
  assert.equal(callerSelection.outcome.kind, "throw");
  if (callerSelection.outcome.kind === "throw") assert.strictEqual(callerSelection.outcome.reason, callerReason);
  assert.strictEqual(callerSelection.report?.origin.signal, caller.signal);
  assert.strictEqual(callerSelection.report?.origin.frame, parent);
  const callerAdmission = caught(() => admitChildCancellation(child, { signal: undefined }));
  assert.equal(callerAdmission.threw, true);
  assert.strictEqual(callerAdmission.reason, callerReason);
  child.close();
  parent.close();
});

test("R05 falsy equal control reasons remain exact and unwrapped", () => {
  const configuredFirst = new AbortController();
  const deliveredFirst = new AbortController();
  const boundary = root({ controls: [
    { role: "budget-control", signal: configuredFirst.signal },
    { role: "pipeline-control", signal: deliveredFirst.signal },
  ] });
  deliveredFirst.abort(false);
  configuredFirst.abort(false);
  let reads = 0;

  const failure = caught(() => admitChildCancellation(boundary, {
    get signal() { reads++; return undefined; },
  }));

  assert.equal(failure.threw, true);
  assert.ok(Object.is(failure.reason, false));
  assert.ok(Object.is(boundary.deliverySignal.reason, false));
  assert.equal(reads, 0);
  boundary.close();
});
