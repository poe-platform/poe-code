import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CancellationCapacityError,
  activateChildCancellation,
  admitChildCancellation,
  createRootCancellationLink,
  prepareChildCancellation,
  selectCancellationOutcome,
  selectRuntimeCancellationOutcome,
  subscribeCancellation,
} from "../../../../src/shell/cancellation.js";
import type {
  CancellationAdmissionSnapshot,
  CancellationBoundary,
  CancellationCloseResult,
  CancellationOrigin,
  CancellationReport,
  CancellationSelection,
  CapturedCancellationOutcome,
  PreparedChildCancellation,
} from "../../../../src/shell/cancellation.js";

const metadata = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as {
  groups: Record<string, { id: string; expected: string }[]>;
};

function bounds(depth: number, resourceLimit = 32): CancellationAdmissionSnapshot {
  return { depth, maxDepth: 16, resourceLimit };
}

function root(input: {
  callerSignal?: AbortSignal | undefined;
  controls?: readonly { role: "budget-control" | "pipeline-control"; signal: AbortSignal }[] | undefined;
  resourceLimit?: number | undefined;
} = {}): CancellationBoundary {
  return createRootCancellationLink({
    admission: bounds(0, input.resourceLimit ?? 32),
    callerSignal: input.callerSignal,
    controls: input.controls,
  });
}

function caught(operation: () => unknown): unknown {
  let didThrow = false;
  let reason: unknown;
  try { operation(); }
  catch (error) { didThrow = true; reason = error; }
  assert.equal(didThrow, true);
  return reason;
}

function returned<Value>(value: Value): CapturedCancellationOutcome<Value> {
  return { kind: "return", value };
}

function thrown(reason: unknown, report?: CancellationReport): CapturedCancellationOutcome<never> {
  return report === undefined ? { kind: "throw", reason } : { kind: "throw", reason, report };
}

function assertThrow<Value>(selection: CancellationSelection<Value>, reason: unknown): void {
  assert.equal(selection.outcome.kind, "throw");
  if (selection.outcome.kind === "throw") assert.ok(Object.is(selection.outcome.reason, reason));
}

function observeNext(boundary: CancellationBoundary): { readonly origins: CancellationOrigin[]; close(): void } {
  const origins: CancellationOrigin[] = [];
  const detach = subscribeCancellation(boundary, origin => { origins.push(origin); });
  return { origins, close: detach };
}

function borrowedVariants(parent: CancellationBoundary): PreparedChildCancellation[] {
  return [
    prepareChildCancellation(parent),
    prepareChildCancellation(parent, undefined, undefined, undefined),
    prepareChildCancellation(parent, {}),
    prepareChildCancellation(parent, { signal: undefined }, undefined, undefined),
  ];
}

interface TestRecord {
  readonly invocation: object;
  readonly promise: Promise<unknown>;
  readonly boundary: CancellationBoundary;
  selection?: CancellationSelection<unknown>;
  consumed: boolean;
  disposed: boolean;
}

class TestOutcomeRegistrar {
  readonly records = new Set<TestRecord>();

  bind(invocation: object, promise: Promise<unknown>, boundary: CancellationBoundary): TestRecord {
    const record: TestRecord = { invocation, promise, boundary, consumed: false, disposed: false };
    this.records.add(record);
    return record;
  }

  finalize(record: TestRecord, selection: CancellationSelection<unknown>): void {
    assert.equal(record.disposed, false);
    record.selection = selection;
  }

  consume(
    invocation: object,
    rawReturn: unknown,
    boundary: CancellationBoundary,
    capturedReason: unknown,
  ): CancellationReport | undefined {
    for (const record of this.records) {
      if (record.disposed || record.consumed || record.invocation !== invocation
        || record.promise !== rawReturn || record.boundary !== boundary) continue;
      const selection = record.selection;
      if (!selection || selection.outcome.kind !== "throw" || !selection.report
        || !Object.is(selection.outcome.reason, capturedReason)) return undefined;
      record.consumed = true;
      record.disposed = true;
      this.records.delete(record);
      return selection.report;
    }
    return undefined;
  }

  discard(record: TestRecord): void {
    record.disposed = true;
    this.records.delete(record);
  }

  close(): void {
    for (const record of this.records) record.disposed = true;
    this.records.clear();
  }
}

test("extension freeze contains 38 unique literal controls", () => {
  const cases = Object.values(metadata.groups).flat();
  assert.equal(cases.length, 38);
  assert.equal(new Set(cases.map(entry => entry.id)).size, 38);
  assert.ok(cases.every(entry => entry.expected.length > 0));
});

test("preparation checks ancestors before one ordinary native-brand lookup", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const ancestorReason = { marker: "ancestor" };
  caller.abort(ancestorReason);
  let skippedReads = 0;
  assert.strictEqual(caught(() => prepareChildCancellation(parent, {
    get signal() { skippedReads++; return undefined; },
  })), ancestorReason);
  assert.equal(skippedReads, 0);
  parent.close();

  const liveParent = root();
  const local = new AbortController();
  let reads = 0;
  const options = {
    get signal() { reads++; return local.signal; },
  };
  const prepared = prepareChildCancellation(liveParent, options, bounds(1));
  assert.equal(reads, 1);
  Object.defineProperty(options, "signal", { value: new AbortController().signal });
  const boundary = activateChildCancellation(prepared);
  assert.equal(reads, 1);
  boundary.close();
  assert.ok(caught(() => prepareChildCancellation(liveParent, { signal: { aborted: false } as never }, bounds(1))) instanceof TypeError);
  liveParent.close();
});

test("borrowed preparation and activation allocate no cancellation resources", () => {
  const parent = root();
  const NativeAbortController = globalThis.AbortController;
  let allocations = 0;
  class CountingAbortController extends NativeAbortController {
    constructor() { super(); allocations++; }
  }
  Object.defineProperty(globalThis, "AbortController", {
    configurable: true,
    writable: true,
    value: CountingAbortController,
  });
  try {
    for (const prepared of borrowedVariants(parent)) {
      assert.equal(prepared.owned, false);
      const boundary = activateChildCancellation(prepared);
      assert.equal(boundary.owned, false);
      assert.strictEqual(boundary.deliverySignal, parent.deliverySignal);
      assert.strictEqual(boundary.close(), boundary.close());
    }
    assert.equal(allocations, 0);
  } finally {
    Object.defineProperty(globalThis, "AbortController", {
      configurable: true,
      writable: true,
      value: NativeAbortController,
    });
    parent.close();
  }
});

test("control-only preparation is inert, owned, copied, and has no invoke rank", () => {
  const parent = root();
  const control = new AbortController();
  const later = new AbortController();
  const controls: { role: "pipeline-control"; signal: AbortSignal }[] = [
    { role: "pipeline-control", signal: control.signal },
  ];
  const prepared = prepareChildCancellation(parent, undefined, bounds(1), controls);
  assert.equal(prepared.owned, true);
  assert.equal(getEventListeners(control.signal, "abort").length, 0);
  controls[0] = { role: "pipeline-control", signal: later.signal };
  controls.push({ role: "pipeline-control", signal: later.signal });
  const boundary = activateChildCancellation(prepared);
  assert.equal(getEventListeners(control.signal, "abort").length, 1);
  assert.equal(getEventListeners(later.signal, "abort").length, 0);
  control.abort("pipeline");
  assert.equal(boundary.deliverySignal.reason, "pipeline");
  assert.deepEqual(selectRuntimeCancellationOutcome(boundary, returned(7)), { outcome: { kind: "return", value: 7 } });
  boundary.close();
  parent.close();
});

test("owned validation is inert and rejects invalid snapshots and controls", () => {
  const parent = root();
  const local = new AbortController();
  for (const snapshot of [undefined, bounds(0), { depth: 1, maxDepth: 15, resourceLimit: 3 }]) {
    assert.ok(caught(() => prepareChildCancellation(parent, { signal: local.signal }, snapshot)) instanceof Error);
  }
  for (const controls of [null, {}, [{ role: "invoke-option", signal: local.signal }], [{ role: "budget-control", signal: {} }]]) {
    assert.ok(caught(() => prepareChildCancellation(parent, undefined, bounds(1), controls as never)) instanceof TypeError);
  }
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  parent.close();
});

test("preparation preserves exact local preabort values without faulty native undefined assumptions", () => {
  for (const reason of [null, 0, false, "", Number.NaN]) {
    const parent = root();
    const local = new AbortController();
    local.abort(reason);
    assert.ok(Object.is(caught(() => prepareChildCancellation(parent, { signal: local.signal }, bounds(1))), reason));
    parent.close();
  }
  const parent = root();
  const local = new AbortController();
  local.abort(Symbol("placeholder"));
  Object.defineProperty(local.signal, "reason", { configurable: true, value: undefined });
  assert.ok(Object.is(caught(() => prepareChildCancellation(parent, { signal: local.signal }, bounds(1))), undefined));
  parent.close();
});

test("activation rechecks parent abort and closure before allocation", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const local = new AbortController();
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  const reason = { marker: "between-parent" };
  caller.abort(reason);
  assert.strictEqual(caught(() => activateChildCancellation(prepared)), reason);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  const replay = caught(() => activateChildCancellation(prepared));
  assert.ok(replay instanceof Error);
  assert.strictEqual(caught(() => activateChildCancellation(prepared)), replay);
  parent.close();

  const closedParent = root();
  const closedPrepared = prepareChildCancellation(closedParent);
  closedParent.close();
  const closedFailure = caught(() => activateChildCancellation(closedPrepared));
  assert.ok(closedFailure instanceof Error);
});

test("activation rechecks local and configured control preaborts before allocation", () => {
  const parent = root();
  const local = new AbortController();
  const localPrepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  const localReason = { marker: "between-local" };
  local.abort(localReason);
  assert.strictEqual(caught(() => activateChildCancellation(localPrepared)), localReason);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);

  const first = new AbortController();
  const second = new AbortController();
  const controlPrepared = prepareChildCancellation(parent, undefined, bounds(1), [
    { role: "pipeline-control", signal: first.signal },
    { role: "budget-control", signal: second.signal },
  ]);
  second.abort("second");
  first.abort("first-configured");
  assert.strictEqual(caught(() => activateChildCancellation(controlPrepared)), "first-configured");
  assert.equal(getEventListeners(first.signal, "abort").length, 0);
  assert.equal(getEventListeners(second.signal, "abort").length, 0);
  parent.close();
});

test("activation rechecks parent capacity and leaves prospective signals clean", () => {
  const parent = root({ resourceLimit: 2 });
  const prospective = new AbortController();
  const prepared = prepareChildCancellation(parent, { signal: prospective.signal }, bounds(1, 2));
  const blockerSignal = new AbortController();
  const blocker = admitChildCancellation(parent, { signal: blockerSignal.signal }, bounds(1, 2));
  assert.ok(caught(() => activateChildCancellation(prepared)) instanceof CancellationCapacityError);
  assert.equal(getEventListeners(prospective.signal, "abort").length, 0);
  blocker.close();
  parent.close();
});

test("ancestor abort during initialization wins and rolls back partial resources", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const local = new AbortController();
  const reason = { marker: "init-parent" };
  const originalAdd = local.signal.addEventListener.bind(local.signal);
  Object.defineProperty(local.signal, "addEventListener", {
    configurable: true,
    value(...args: Parameters<AbortSignal["addEventListener"]>) {
      const result = Reflect.apply(originalAdd, local.signal, args);
      caller.abort(reason);
      return result;
    },
  });
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  assert.strictEqual(caught(() => activateChildCancellation(prepared)), reason);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  parent.close();
});

test("local invoke outranks a control abort during initialization and rollback is complete", () => {
  const parent = root();
  const local = new AbortController();
  const control = new AbortController();
  const localReason = { marker: "init-local" };
  const originalAdd = control.signal.addEventListener.bind(control.signal);
  Object.defineProperty(control.signal, "addEventListener", {
    configurable: true,
    value(...args: Parameters<AbortSignal["addEventListener"]>) {
      const result = Reflect.apply(originalAdd, control.signal, args);
      local.abort(localReason);
      control.abort("control");
      return result;
    },
  });
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1), [
    { role: "pipeline-control", signal: control.signal },
  ]);
  assert.strictEqual(caught(() => activateChildCancellation(prepared)), localReason);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  assert.equal(getEventListeners(control.signal, "abort").length, 0);
  parent.close();
});

test("listener initialization failure rolls back prior listeners and parent admission", () => {
  const parent = root({ resourceLimit: 2 });
  const local = new AbortController();
  const broken = new AbortController();
  const setupFailure = { marker: "setup" };
  Object.defineProperty(broken.signal, "addEventListener", {
    configurable: true,
    value() { throw setupFailure; },
  });
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1, 3), [
    { role: "pipeline-control", signal: broken.signal },
  ]);
  assert.strictEqual(caught(() => activateChildCancellation(prepared)), setupFailure);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  const healthy = new AbortController();
  const next = activateChildCancellation(prepareChildCancellation(parent, { signal: healthy.signal }, bounds(1, 2)));
  next.close();
  parent.close();
});

test("cleanup is registered before activation acquisition and is safe after failure", () => {
  const parent = root();
  const local = new AbortController();
  const sequence: string[] = [];
  let cleanup: (() => CancellationCloseResult | undefined) | undefined;
  let boundary: CancellationBoundary | undefined;
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  cleanup = () => boundary?.close();
  sequence.push("registered");
  const originalAdd = local.signal.addEventListener.bind(local.signal);
  Object.defineProperty(local.signal, "addEventListener", {
    configurable: true,
    value(...args: Parameters<AbortSignal["addEventListener"]>) {
      sequence.push("acquired");
      return Reflect.apply(originalAdd, local.signal, args);
    },
  });
  boundary = activateChildCancellation(prepared);
  assert.deepEqual(sequence, ["registered", "acquired"]);
  assert.strictEqual(cleanup(), cleanup());
  parent.close();

  const failureParent = root();
  const broken = new AbortController();
  Object.defineProperty(broken.signal, "addEventListener", { configurable: true, value() { throw "init"; } });
  let failedBoundary: CancellationBoundary | undefined;
  const failureCleanup = () => failedBoundary?.close();
  const failurePrepared = prepareChildCancellation(failureParent, { signal: broken.signal }, bounds(1));
  assert.strictEqual(caught(() => { failedBoundary = activateChildCancellation(failurePrepared); }), "init");
  assert.equal(failureCleanup(), undefined);
  assert.equal(getEventListeners(broken.signal, "abort").length, 0);
  failureParent.close();
});

test("nested original controls retain frames, rank, first delivery, and downward isolation", () => {
  const caller = new AbortController();
  const rootBoundary = root({ callerSignal: caller.signal });
  const outerInvoke = new AbortController();
  const outerPipe = new AbortController();
  const outer = activateChildCancellation(prepareChildCancellation(rootBoundary, { signal: outerInvoke.signal }, bounds(1), [
    { role: "pipeline-control", signal: outerPipe.signal },
  ]));
  const innerInvoke = new AbortController();
  const innerPipe = new AbortController();
  const inner = activateChildCancellation(prepareChildCancellation(outer, { signal: innerInvoke.signal }, bounds(2), [
    { role: "pipeline-control", signal: innerPipe.signal },
  ]));
  const siblingSignal = new AbortController();
  const sibling = activateChildCancellation(prepareChildCancellation(outer, { signal: siblingSignal.signal }, bounds(2)));
  const seen = observeNext(inner);
  innerPipe.abort("inner-pipe");
  assert.equal(inner.deliverySignal.reason, "inner-pipe");
  assert.equal(outer.deliverySignal.aborted, false);
  assert.equal(sibling.deliverySignal.aborted, false);
  assert.equal(seen.origins[0]?.role, "pipeline-control");
  assert.strictEqual(seen.origins[0]?.frame, inner);
  outerInvoke.abort("outer-invoke");
  assert.equal(inner.deliverySignal.reason, "inner-pipe");
  assertThrow(selectRuntimeCancellationOutcome(inner, returned(0)), "outer-invoke");
  caller.abort("root");
  assertThrow(selectRuntimeCancellationOutcome(inner, returned(0)), "root");
  seen.close();
  sibling.close();
  inner.close();
  outer.close();
  rootBoundary.close();
});

test("post-listener first control delivery is immutable", () => {
  const parent = root();
  const firstConfigured = new AbortController();
  const secondConfigured = new AbortController();
  const boundary = activateChildCancellation(prepareChildCancellation(parent, undefined, bounds(1), [
    { role: "budget-control", signal: firstConfigured.signal },
    { role: "pipeline-control", signal: secondConfigured.signal },
  ]));
  const seen = observeNext(boundary);
  secondConfigured.abort("delivered-second");
  firstConfigured.abort("later-first");
  assert.equal(boundary.deliverySignal.reason, "delivered-second");
  assert.strictEqual(seen.origins[0]?.signal, secondConfigured.signal);
  seen.close();
  boundary.close();
  parent.close();
});

test("strict selector rejects equal unproven throws and accepts exact observed origins", () => {
  for (const reason of [null, 0, false, "", Number.NaN]) {
    const parent = root();
    const local = new AbortController();
    const child = activateChildCancellation(prepareChildCancellation(parent, { signal: local.signal }, bounds(1)));
    const observer = observeNext(child);
    local.abort(reason);
    const origin = observer.origins[0];
    assert.ok(origin);
    const unproven = selectRuntimeCancellationOutcome(child, thrown(reason));
    assertThrow(unproven, reason);
    assert.equal(unproven.report, undefined);
    const proven = selectRuntimeCancellationOutcome(child, thrown(reason), origin);
    assertThrow(proven, reason);
    assert.strictEqual(proven.report?.origin, origin);
    observer.close();
    child.close();
    parent.close();
  }

  const parent = root();
  const local = new AbortController();
  const child = activateChildCancellation(prepareChildCancellation(parent, { signal: local.signal }, bounds(1)));
  local.abort("not-undefined");
  const undefinedThrow = selectRuntimeCancellationOutcome(child, thrown(undefined));
  assert.ok(Object.is(undefinedThrow.outcome.kind === "throw" ? undefinedThrow.outcome.reason : 1, undefined));
  assert.equal(undefinedThrow.report, undefined);
  child.close();
  parent.close();
});

test("strict selector rejects a foreign sibling origin despite an equal reason", () => {
  const parent = root();
  const leftSignal = new AbortController();
  const rightSignal = new AbortController();
  const left = activateChildCancellation(prepareChildCancellation(parent, { signal: leftSignal.signal }, bounds(1)));
  const right = activateChildCancellation(prepareChildCancellation(parent, { signal: rightSignal.signal }, bounds(1)));
  const leftObserver = observeNext(left);
  const rightObserver = observeNext(right);
  leftSignal.abort(false);
  rightSignal.abort(false);
  const selection = selectRuntimeCancellationOutcome(right, thrown(false), leftObserver.origins[0]);
  assertThrow(selection, false);
  assert.equal(selection.report, undefined);
  leftObserver.close();
  rightObserver.close();
  left.close();
  right.close();
  parent.close();
});

test("strict descendant reports target one parent while the old selector stays unchanged", () => {
  const rootBoundary = root();
  const outerSignal = new AbortController();
  const outer = activateChildCancellation(prepareChildCancellation(rootBoundary, { signal: outerSignal.signal }, bounds(1)));
  const innerSignal = new AbortController();
  const inner = activateChildCancellation(prepareChildCancellation(outer, { signal: innerSignal.signal }, bounds(2)));
  const observer = observeNext(inner);
  innerSignal.abort("same");
  const innerSelection = selectRuntimeCancellationOutcome(inner, thrown("same"), observer.origins[0]);
  assert.ok(innerSelection.report);
  const outerSelection = selectRuntimeCancellationOutcome(outer, thrown("same", innerSelection.report));
  assert.ok(outerSelection.report);
  const rootSelection = selectRuntimeCancellationOutcome(rootBoundary, thrown("same", innerSelection.report));
  assert.equal(rootSelection.report, undefined);

  const oldSelection = selectCancellationOutcome(inner, thrown("same"));
  assert.ok(oldSelection.report);
  observer.close();
  inner.close();
  outer.close();
  rootBoundary.close();
});

test("root caller exact reason remains highest and close prevents retroactive improvement", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const local = new AbortController();
  const child = activateChildCancellation(prepareChildCancellation(parent, { signal: local.signal }, bounds(1)));
  local.abort("local");
  child.close();
  caller.abort("root");
  assertThrow(selectRuntimeCancellationOutcome(child, returned(0)), "local");
  const parentSelection = selectRuntimeCancellationOutcome(parent, thrown("unrelated"));
  assertThrow(parentSelection, "root");
  assert.equal(parentSelection.report, undefined);
  parent.close();
});

test("test-local transport binds exact invocation, Promise, boundary, and one-shot disposal", () => {
  const parent = root();
  const local = new AbortController();
  const child = activateChildCancellation(prepareChildCancellation(parent, { signal: local.signal }, bounds(1)));
  const observer = observeNext(child);
  const reason = false;
  local.abort(reason);
  const selection = selectRuntimeCancellationOutcome(child, thrown(reason), observer.origins[0]);
  assert.ok(selection.report);
  const registrar = new TestOutcomeRegistrar();
  const invocation = {};
  const promise = Promise.reject(reason);
  void promise.catch(() => undefined);
  const record = registrar.bind(invocation, promise, child);
  registrar.finalize(record, selection);
  assert.equal(registrar.consume({}, promise, child, reason), undefined);
  assert.equal(registrar.consume(invocation, Promise.resolve(reason), child, reason), undefined);
  assert.equal(registrar.consume(invocation, promise, parent, reason), undefined);
  assert.strictEqual(registrar.consume(invocation, promise, child, reason), selection.report);
  assert.equal(registrar.consume(invocation, promise, child, reason), undefined);
  registrar.close();
  observer.close();
  child.close();
  parent.close();
});

test("equal sibling and adopted async promises cannot consume another record", async () => {
  const parent = root();
  const local = new AbortController();
  const child = activateChildCancellation(prepareChildCancellation(parent, { signal: local.signal }, bounds(1)));
  const observer = observeNext(child);
  local.abort(0);
  const selection = selectRuntimeCancellationOutcome(child, thrown(0), observer.origins[0]);
  const registrar = new TestOutcomeRegistrar();
  const invocation = {};
  const original = Promise.reject(0);
  void original.catch(() => undefined);
  const adopted = (async () => original)();
  void adopted.catch(() => undefined);
  assert.notStrictEqual(adopted, original);
  const record = registrar.bind(invocation, original, child);
  registrar.finalize(record, selection);
  assert.equal(registrar.consume(invocation, adopted, child, 0), undefined);
  const unknown = selectRuntimeCancellationOutcome(child, thrown(await adopted.catch(error => error)));
  assert.equal(unknown.report, undefined);
  registrar.discard(record);
  assert.equal(registrar.records.size, 0);
  observer.close();
  child.close();
  parent.close();
});

test("R08-style ordinary error-to-status mapping discards report without borrowed-parent poisoning", () => {
  const parent = root();
  const borrowed = activateChildCancellation(prepareChildCancellation(parent));
  const innerSignal = new AbortController();
  const inner = activateChildCancellation(prepareChildCancellation(parent, { signal: innerSignal.signal }, bounds(1)));
  const observer = observeNext(inner);
  innerSignal.abort("");
  const innerSelection = selectRuntimeCancellationOutcome(inner, thrown(""), observer.origins[0]);
  const registrar = new TestOutcomeRegistrar();
  const invocation = {};
  const promise = Promise.reject("");
  void promise.catch(() => undefined);
  const record = registrar.bind(invocation, promise, inner);
  registrar.finalize(record, innerSelection);

  registrar.discard(record);
  const mappedStatus = 1;
  const outerSelection = selectRuntimeCancellationOutcome(borrowed, returned(mappedStatus));
  assert.deepEqual(outerSelection, { outcome: { kind: "return", value: 1 } });
  const publicWrapperStatus = outerSelection.outcome.kind === "return" ? 0 : 1;
  assert.equal(publicWrapperStatus, 0);
  assert.equal(parent.deliverySignal.aborted, false);
  assert.equal(registrar.records.size, 0);
  registrar.close();
  observer.close();
  inner.close();
  borrowed.close();
  parent.close();
});

