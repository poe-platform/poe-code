import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CancellationCapacityError,
  admitChildCancellation,
  createRootCancellationLink,
  selectCancellationOutcome,
  subscribeCancellation,
} from "../../../src/shell/cancellation.js";
import type {
  CancellationAdmissionSnapshot,
  CancellationBoundary,
  CancellationInvokeOptions,
  CancellationReport,
  CancellationSelection,
  CapturedCancellationOutcome,
} from "../../../src/shell/cancellation.js";

const metadata = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as {
  groups: Record<string, { id: string; expected: string }[]>;
};

function bounds(depth: number, maxDepth = 16, resourceLimit = 32): CancellationAdmissionSnapshot {
  return { depth, maxDepth, resourceLimit };
}

function root(options: {
  callerSignal?: AbortSignal | undefined;
  controls?: readonly { role: "budget-control" | "pipeline-control"; signal: AbortSignal }[] | undefined;
  resourceLimit?: number | undefined;
} = {}): CancellationBoundary {
  return createRootCancellationLink({
    admission: bounds(0, 16, options.resourceLimit ?? 32),
    callerSignal: options.callerSignal,
    controls: options.controls,
  });
}

function abortWith(reason: unknown): AbortController {
  const controller = new AbortController();
  if (reason === undefined) {
    controller.abort(Symbol("native-placeholder"));
    Object.defineProperty(controller.signal, "reason", { configurable: true, value: undefined });
  } else controller.abort(reason);
  return controller;
}

function catchThrown(operation: () => unknown): unknown {
  let threw = false;
  let reason: unknown;
  try { operation(); }
  catch (error) { threw = true; reason = error; }
  assert.equal(threw, true);
  return reason;
}

function returned<Value>(value: Value): CapturedCancellationOutcome<Value> {
  return { kind: "return", value };
}

function thrown(reason: unknown, report?: CancellationReport): CapturedCancellationOutcome<never> {
  return report === undefined ? { kind: "throw", reason } : { kind: "throw", reason, report };
}

function assertSelectionThrows<Value>(selection: CancellationSelection<Value>, reason: unknown): void {
  assert.equal(selection.outcome.kind, "throw");
  if (selection.outcome.kind === "throw") assert.ok(Object.is(selection.outcome.reason, reason));
}

test("freeze metadata contains unique literal cases", () => {
  const cases = Object.values(metadata.groups).flat();
  assert.equal(cases.length, 38);
  assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length);
  assert.ok(cases.every(entry => entry.expected.length > 0));
});

test("omitted and undefined signal paths borrow without closing the parent", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const variants = [
    admitChildCancellation(parent),
    admitChildCancellation(parent, undefined),
    admitChildCancellation(parent, {}),
    admitChildCancellation(parent, { signal: undefined }),
  ];
  for (const boundary of variants) {
    assert.equal(boundary.owned, false);
    assert.equal(boundary.deliverySignal, parent.deliverySignal);
    assert.strictEqual(boundary.close(), boundary.close());
  }
  caller.abort("still-live");
  assert.equal(parent.deliverySignal.reason, "still-live");
  parent.close();
});

test("invalid containers and non-native signal values fail before child resources", () => {
  const parent = root();
  for (const invalid of [null, 0, false, "", Symbol("options")]) {
    assert.ok(catchThrown(() => admitChildCancellation(parent, invalid as never, bounds(1))) instanceof TypeError);
  }
  const controller = new AbortController();
  for (const invalid of [controller, { aborted: false, reason: undefined }, null, 0, false, ""]) {
    assert.ok(catchThrown(() => admitChildCancellation(parent, { signal: invalid } as never, bounds(1))) instanceof TypeError);
  }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  parent.close();
});

test("ordinary inherited, array, function, and read-once lookup semantics are retained", () => {
  const parent = root();
  const inheritedSignal = new AbortController();
  const inherited = Object.create({ signal: inheritedSignal.signal }) as CancellationInvokeOptions;
  const inheritedBoundary = admitChildCancellation(parent, inherited, bounds(1));
  assert.equal(inheritedBoundary.owned, true);
  inheritedBoundary.close();

  const arraySignal = new AbortController();
  const arrayOptions: unknown[] & { signal?: AbortSignal } = [];
  arrayOptions.signal = arraySignal.signal;
  assert.equal(admitChildCancellation(parent, arrayOptions as never, bounds(1)).close().failures.length, 0);

  const functionSignal = new AbortController();
  const functionOptions = Object.assign(() => undefined, { signal: functionSignal.signal });
  assert.equal(admitChildCancellation(parent, functionOptions as never, bounds(1)).close().failures.length, 0);

  let reads = 0;
  const getterSignal = new AbortController();
  const getterBoundary = admitChildCancellation(parent, {
    get signal() { reads++; return getterSignal.signal; },
  }, bounds(1));
  assert.equal(reads, 1);
  getterBoundary.close();
  parent.close();
});

test("getter failures preserve exact identity including undefined", () => {
  for (const failure of [undefined, null, 0, false, "", Number.NaN, { marker: "getter" }]) {
    const parent = root();
    const observed = catchThrown(() => admitChildCancellation(parent, {
      get signal(): AbortSignal { throw failure; },
    }, bounds(1)));
    assert.ok(Object.is(observed, failure));
    parent.close();
  }
});

test("pre-aborted ancestor skips lookup and ancestor abort during lookup beats the staged failure", () => {
  const firstReason = { marker: "entry-root" };
  const firstCaller = abortWith(firstReason);
  const firstParent = root({ callerSignal: firstCaller.signal });
  let reads = 0;
  assert.strictEqual(catchThrown(() => admitChildCancellation(firstParent, {
    get signal() { reads++; return undefined; },
  })), firstReason);
  assert.equal(reads, 0);
  firstParent.close();

  const secondReason = { marker: "getter-root" };
  const getterFailure = { marker: "getter-failure" };
  const secondCaller = new AbortController();
  const secondParent = root({ callerSignal: secondCaller.signal });
  assert.strictEqual(catchThrown(() => admitChildCancellation(secondParent, {
    get signal(): AbortSignal { secondCaller.abort(secondReason); throw getterFailure; },
  }, bounds(1))), secondReason);
  secondParent.close();
});

test("parent closed admission is stable but an aborted ancestor has priority", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  parent.close();
  const closedReason = catchThrown(() => admitChildCancellation(parent));
  assert.ok(closedReason instanceof Error);
  assert.strictEqual(catchThrown(() => admitChildCancellation(parent)), closedReason);
  const rootReason = { marker: "late-root" };
  caller.abort(rootReason);
  assert.strictEqual(catchThrown(() => admitChildCancellation(parent, null as never)), rootReason);
});

test("a getter that closes its parent loses to the stable closed-admission error", () => {
  const parent = root();
  const getterFailure = { marker: "getter" };
  const observed = catchThrown(() => admitChildCancellation(parent, {
    get signal(): AbortSignal { parent.close(); throw getterFailure; },
  }, bounds(1)));
  assert.notStrictEqual(observed, getterFailure);
  assert.strictEqual(catchThrown(() => admitChildCancellation(parent)), observed);
});

test("pre-aborted local signals preserve falsy and NaN reason identity", () => {
  for (const reason of [undefined, null, 0, false, "", Number.NaN]) {
    const parent = root();
    const local = abortWith(reason);
    const observed = catchThrown(() => admitChildCancellation(parent, { signal: local.signal }, bounds(1)));
    assert.ok(Object.is(observed, reason));
    assert.equal(getEventListeners(local.signal, "abort").length, 0);
    parent.close();
  }
});

test("bounded snapshots reject before local listeners", () => {
  const parent = root();
  const local = new AbortController();
  const invalid = [
    { depth: 0, maxDepth: 16, resourceLimit: 3 },
    { depth: 17, maxDepth: 16, resourceLimit: 3 },
    { depth: 1.5, maxDepth: 16, resourceLimit: 3 },
    { depth: 1, maxDepth: Number.MAX_SAFE_INTEGER + 1, resourceLimit: 3 },
    { depth: 1, maxDepth: 16, resourceLimit: 1 },
  ];
  for (const snapshot of invalid) {
    assert.ok(catchThrown(() => admitChildCancellation(parent, { signal: local.signal }, snapshot)) instanceof RangeError);
    assert.equal(getEventListeners(local.signal, "abort").length, 0);
  }
  parent.close();
});

test("failed owned initialization rolls back its parent subscription", () => {
  const parent = root({ resourceLimit: 2 });
  const broken = new AbortController();
  const setupFailure = { marker: "add-listener" };
  Object.defineProperty(broken.signal, "addEventListener", {
    configurable: true,
    value() { throw setupFailure; },
  });
  assert.strictEqual(catchThrown(() => admitChildCancellation(parent, { signal: broken.signal }, bounds(1, 16, 2))), setupFailure);
  const healthy = new AbortController();
  const child = admitChildCancellation(parent, { signal: healthy.signal }, bounds(1, 16, 2));
  child.close();
  parent.close();
});

test("inner then outer then root keeps first delivery and selects root", () => {
  const rootCaller = new AbortController();
  const rootBoundary = root({ callerSignal: rootCaller.signal });
  const outerController = new AbortController();
  const outer = admitChildCancellation(rootBoundary, { signal: outerController.signal }, bounds(1));
  const innerController = new AbortController();
  const inner = admitChildCancellation(outer, { signal: innerController.signal }, bounds(2));
  const innerReason = { marker: "inner" };
  const outerReason = { marker: "outer" };
  const rootReason = { marker: "root" };
  innerController.abort(innerReason);
  assert.strictEqual(inner.deliverySignal.reason, innerReason);
  outerController.abort(outerReason);
  rootCaller.abort(rootReason);
  assert.strictEqual(inner.deliverySignal.reason, innerReason);
  const innerSelection = selectCancellationOutcome(inner, returned(7));
  assertSelectionThrows(innerSelection, rootReason);
  assert.equal(innerSelection.report?.origin.role, "root-caller");
  inner.close();
  const outerSelection = selectCancellationOutcome(outer, thrown(rootReason, innerSelection.report));
  assertSelectionThrows(outerSelection, rootReason);
  outer.close();
  const rootSelection = selectCancellationOutcome(rootBoundary, thrown(rootReason, outerSelection.report));
  assertSelectionThrows(rootSelection, rootReason);
  rootBoundary.close();
});

test("root-first and outer-first event orders preserve first-delivered reason", () => {
  const caller = new AbortController();
  const firstRoot = root({ callerSignal: caller.signal });
  const outerController = new AbortController();
  const outer = admitChildCancellation(firstRoot, { signal: outerController.signal }, bounds(1));
  const innerController = new AbortController();
  const inner = admitChildCancellation(outer, { signal: innerController.signal }, bounds(2));
  caller.abort("root");
  outerController.abort("outer");
  innerController.abort("inner");
  assert.equal(inner.deliverySignal.reason, "root");
  assertSelectionThrows(selectCancellationOutcome(inner, returned(0)), "root");
  inner.close(); outer.close(); firstRoot.close();

  const secondRoot = root();
  const secondOuterController = new AbortController();
  const secondOuter = admitChildCancellation(secondRoot, { signal: secondOuterController.signal }, bounds(1));
  const secondInnerController = new AbortController();
  const secondInner = admitChildCancellation(secondOuter, { signal: secondInnerController.signal }, bounds(2));
  secondOuterController.abort("outer-first");
  secondInnerController.abort("inner-late");
  assert.equal(secondInner.deliverySignal.reason, "outer-first");
  assertSelectionThrows(selectCancellationOutcome(secondInner, returned(0)), "outer-first");
  secondInner.close(); secondOuter.close(); secondRoot.close();
});

test("a closed inner boundary does not retroactively change after ancestor abort", () => {
  const rootCaller = new AbortController();
  const rootBoundary = root({ callerSignal: rootCaller.signal });
  const outerController = new AbortController();
  const outer = admitChildCancellation(rootBoundary, { signal: outerController.signal }, bounds(1));
  const innerController = new AbortController();
  const inner = admitChildCancellation(outer, { signal: innerController.signal }, bounds(2));
  innerController.abort("inner");
  const closedSelection = selectCancellationOutcome(inner, returned(0));
  assertSelectionThrows(closedSelection, "inner");
  inner.close();
  outerController.abort("outer");
  rootCaller.abort("root");
  assert.equal(inner.deliverySignal.reason, "inner");
  const repeated = selectCancellationOutcome(inner, returned(0));
  assertSelectionThrows(repeated, "inner");
  outer.close(); rootBoundary.close();
});

test("numeric results are replaced by invoke cancellation but unrelated errors are exact", () => {
  const parent = root();
  const localController = new AbortController();
  const child = admitChildCancellation(parent, { signal: localController.signal }, bounds(1));
  const ownReason = { marker: "deadline" };
  localController.abort(ownReason);
  assertSelectionThrows(selectCancellationOutcome(child, returned(23)), ownReason);
  const unrelated = { marker: "execution" };
  const unrelatedSelection = selectCancellationOutcome(child, thrown(unrelated));
  assertSelectionThrows(unrelatedSelection, unrelated);
  assert.equal(unrelatedSelection.report, undefined);
  child.close(); parent.close();
});

test("reported descendant cancellation can improve to outer while control failure cannot", () => {
  const control = new AbortController();
  const rootBoundary = root({ controls: [{ role: "budget-control", signal: control.signal }] });
  const outerController = new AbortController();
  const outer = admitChildCancellation(rootBoundary, { signal: outerController.signal }, bounds(1));
  const innerController = new AbortController();
  const inner = admitChildCancellation(outer, { signal: innerController.signal }, bounds(2));
  innerController.abort("inner");
  const innerSelection = selectCancellationOutcome(inner, thrown("inner"));
  inner.close();
  outerController.abort("outer");
  const outerSelection = selectCancellationOutcome(outer, thrown("inner", innerSelection.report));
  assertSelectionThrows(outerSelection, "outer");

  control.abort("budget");
  const controlSelection = selectCancellationOutcome(outer, thrown("budget"));
  assertSelectionThrows(controlSelection, "budget");
  assert.equal(controlSelection.report?.origin.role, "budget-control");
  outer.close(); rootBoundary.close();
});

test("root caller beats an unrelated execution failure", () => {
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal });
  const local = new AbortController();
  const child = admitChildCancellation(parent, { signal: local.signal }, bounds(1));
  const executionFailure = { marker: "execution" };
  const rootReason = { marker: "root" };
  local.abort("local");
  caller.abort(rootReason);
  assertSelectionThrows(selectCancellationOutcome(child, thrown(executionFailure)), rootReason);
  child.close(); parent.close();
});

test("explicit reports preserve NaN and thrown undefined without truthiness", () => {
  for (const reason of [Number.NaN, undefined]) {
    const parent = root();
    const local = new AbortController();
    const child = admitChildCancellation(parent, { signal: local.signal }, bounds(1));
    if (reason === undefined) {
      local.abort(Symbol("placeholder"));
      Object.defineProperty(local.signal, "reason", { configurable: true, value: undefined });
    } else local.abort(reason);
    const childSelection = selectCancellationOutcome(child, thrown(reason));
    assertSelectionThrows(childSelection, reason);
    child.close();
    const parentSelection = selectCancellationOutcome(parent, thrown(reason, childSelection.report));
    assertSelectionThrows(parentSelection, reason);
    assert.equal(parentSelection.report, undefined);
    parent.close();
  }
});

test("handled child and sibling primitive reports do not poison parent selection", () => {
  const parent = root();
  const firstController = new AbortController();
  const first = admitChildCancellation(parent, { signal: firstController.signal }, bounds(1));
  firstController.abort(false);
  const firstSelection = selectCancellationOutcome(first, thrown(false));
  assert.equal(firstSelection.report?.origin.role, "invoke-option");
  first.close();

  const handled = selectCancellationOutcome(parent, returned(0));
  assert.deepEqual(handled, { outcome: { kind: "return", value: 0 } });
  const unrelatedSibling = selectCancellationOutcome(parent, thrown(false));
  assertSelectionThrows(unrelatedSibling, false);
  assert.equal(unrelatedSibling.report, undefined);
  parent.close();
});

test("callback failures are exact, detached, and separate from outcome selection", () => {
  const control = new AbortController();
  const caller = new AbortController();
  const parent = root({ callerSignal: caller.signal, controls: [{ role: "pipeline-control", signal: control.signal }] });
  let calls = 0;
  const callbackFailure = { marker: "callback" };
  subscribeCancellation(parent, () => { calls++; throw callbackFailure; });
  control.abort("pipeline");
  caller.abort("root");
  assert.equal(calls, 1);
  const selected = selectCancellationOutcome(parent, returned(0));
  assertSelectionThrows(selected, "root");
  const closed = parent.close();
  assert.deepEqual(closed.failures, [callbackFailure]);

  const undefinedParent = root();
  const undefinedControl = new AbortController();
  const child = admitChildCancellation(undefinedParent, { signal: undefinedControl.signal }, bounds(1));
  subscribeCancellation(child, () => { throw undefined; });
  undefinedControl.abort("local");
  assert.equal(child.close().failures.length, 1);
  assert.strictEqual(child.close().failures[0], undefined);
  undefinedParent.close();
});

test("owned listeners detach and repeated close returns the same report", () => {
  const caller = new AbortController();
  const control = new AbortController();
  const parent = root({ callerSignal: caller.signal, controls: [{ role: "budget-control", signal: control.signal }] });
  const local = new AbortController();
  const child = admitChildCancellation(parent, { signal: local.signal }, bounds(1));
  assert.equal(getEventListeners(caller.signal, "abort").length, 1);
  assert.equal(getEventListeners(control.signal, "abort").length, 1);
  assert.equal(getEventListeners(local.signal, "abort").length, 1);
  const childClose = child.close();
  assert.strictEqual(child.close(), childClose);
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  const rootClose = parent.close();
  assert.strictEqual(parent.close(), rootClose);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  assert.equal(getEventListeners(control.signal, "abort").length, 0);
});

test("parent capacity fails before prospective child listener admission and is released on close", () => {
  const parent = root({ resourceLimit: 2 });
  const firstController = new AbortController();
  const first = admitChildCancellation(parent, { signal: firstController.signal }, bounds(1, 16, 2));
  const secondController = new AbortController();
  const capacityFailure = catchThrown(() => admitChildCancellation(parent, { signal: secondController.signal }, bounds(1, 16, 2)));
  assert.ok(capacityFailure instanceof CancellationCapacityError);
  assert.equal(getEventListeners(secondController.signal, "abort").length, 0);
  first.close();
  const second = admitChildCancellation(parent, { signal: secondController.signal }, bounds(1, 16, 2));
  second.close(); parent.close();
});
