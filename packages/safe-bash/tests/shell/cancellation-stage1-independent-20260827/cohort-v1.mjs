import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const api = await import(pathToFileURL(process.env.CANCELLATION_MODULE).href);
const { createRootCancellationLink, admitChildCancellation, subscribeCancellation,
  selectCancellationOutcome, CancellationCapacityError } = api;
const bounds = (depth, resourceLimit = 24, maxDepth = 8) => ({ depth, resourceLimit, maxDepth });
const returned = (value = 19) => ({ kind: 'return', value });
const thrown = (reason, report) => ({ kind: 'throw', reason, report });
const root = (extra = {}, limit = 24) => createRootCancellationLink({ admission: bounds(0, limit), ...extra });
const child = (parent, controller, depth, limit = 24) =>
  admitChildCancellation(parent, { signal: controller.signal }, bounds(depth, limit));
function caught(operation) {
  let didThrow = false;
  let reason;
  try { operation(); } catch (error) { didThrow = true; reason = error; }
  assert.equal(didThrow, true, 'operation must throw');
  return reason;
}
function selected(boundary, captured, reason, signal, frame, role = 'invoke-option') {
  const selection = selectCancellationOutcome(boundary, captured);
  assert.equal(selection.outcome.kind, 'throw');
  assert.ok(Object.is(selection.outcome.reason, reason), 'exact selected reason');
  if (signal) {
    assert.ok(selection.report, 'non-root cancellation must provide report');
    assert.equal(selection.report.origin.signal, signal, 'original signal identity');
    assert.equal(selection.report.origin.frame, frame, 'original boundary identity');
    assert.equal(selection.report.origin.role, role);
  }
  return selection;
}
function rig(context, extra = {}, limit = 24) {
  const owned = [];
  const signals = [];
  const result = {
    controller() { const controller = new AbortController(); signals.push(controller.signal); return controller; },
    keep(boundary) { owned.push(boundary); return boundary; },
  };
  result.root = result.keep(root(extra, limit));
  context.after(() => {
    for (const boundary of owned.reverse()) boundary.close();
    for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0, 'owned listener cleanup');
  });
  return result;
}
function abortExact(controller, reason) {
  if (reason === undefined) Object.defineProperty(controller.signal, 'reason', { value: undefined, configurable: true });
  controller.abort(reason === undefined ? Symbol('native non-default reason') : reason);
}

test('H01 three generations retain original provenance across rank upgrades', context => {
  const caller = new AbortController();
  const scope = rig(context, { callerSignal: caller.signal });
  const outerSignal = scope.controller();
  const middleSignal = scope.controller();
  const innerSignal = scope.controller();
  const outer = scope.keep(child(scope.root, outerSignal, 1));
  const middle = scope.keep(child(outer, middleSignal, 2));
  const inner = scope.keep(child(middle, innerSignal, 3));
  const localReason = Object.freeze({ marker: 'same-message' });
  const outerReason = Object.freeze({ marker: 'same-message' });
  const callerReason = Object.freeze({ marker: 'same-message' });
  innerSignal.abort(localReason);
  const initial = selected(inner, returned(), localReason, innerSignal.signal, inner);
  const propagated = selected(middle, thrown(localReason, initial.report), localReason, innerSignal.signal, inner);
  selected(outer, thrown(localReason, propagated.report), localReason, innerSignal.signal, inner);
  assert.deepEqual(selectCancellationOutcome(outer, returned()).outcome, returned());
  outerSignal.abort(outerReason);
  selected(inner, thrown(localReason), outerReason, outerSignal.signal, outer);
  caller.abort(callerReason);
  selected(inner, thrown({ unrelated: true }), callerReason, caller.signal, scope.root, 'root-caller');
  assert.equal(inner.deliverySignal.reason, localReason, 'first delivered reason never upgrades');
  assert.notEqual(inner.deliverySignal, innerSignal.signal);
  assert.equal(scope.root.close().failures.length, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('H02 closed child is stable while open ancestor upgrades', context => {
  const caller = new AbortController();
  const scope = rig(context, { callerSignal: caller.signal });
  const outerSignal = scope.controller();
  const innerSignal = scope.controller();
  const outer = scope.keep(child(scope.root, outerSignal, 1));
  const inner = scope.keep(child(outer, innerSignal, 2));
  const reason = { stopped: 'inner' };
  innerSignal.abort(reason);
  const report = inner.close();
  outerSignal.abort({ stopped: 'outer' });
  caller.abort({ stopped: 'root' });
  selected(inner, returned(), reason, innerSignal.signal, inner);
  selected(outer, returned(), caller.signal.reason, caller.signal, scope.root, 'root-caller');
  assert.equal(inner.deliverySignal.reason, reason);
  assert.equal(inner.close(), report);
  assert.equal(getEventListeners(innerSignal.signal, 'abort').length, 0);
});

test('H03 sibling reports are targeted, exact and non-poisoning for seven reason classes', context => {
  for (const reason of [undefined, null, false, 0, '', NaN, -0]) {
    const scope = rig(context);
    const outerSignal = scope.controller();
    const outer = scope.keep(child(scope.root, outerSignal, 1));
    const leftSignal = scope.controller();
    const rightSignal = scope.controller();
    const left = scope.keep(child(outer, leftSignal, 2));
    const right = scope.keep(child(outer, rightSignal, 2));
    abortExact(leftSignal, reason);
    const leftSelection = selected(left, returned(), reason, leftSignal.signal, left);
    const wrongTarget = selected(right, thrown(reason, leftSelection.report), reason);
    assert.equal(wrongTarget.report, undefined, 'sibling report is not targeted at sibling');
    abortExact(rightSignal, reason);
    const rightSelection = selected(right, returned(), reason, rightSignal.signal, right);
    assert.notEqual(leftSelection.report, rightSelection.report);
    const mismatch = Object.is(reason, -0) ? 0 : Symbol('different captured rejection');
    assert.equal(selected(outer, thrown(mismatch, leftSelection.report), mismatch).report, undefined);
    assert.deepEqual(selectCancellationOutcome(outer, returned()).outcome, returned());
    const deadline = { deadline: reason };
    outerSignal.abort(deadline);
    selected(outer, thrown(reason, leftSelection.report), deadline, outerSignal.signal, outer);
    selected(outer, thrown(reason, rightSelection.report), deadline, outerSignal.signal, outer);
    assert.equal(selected(outer, thrown(reason), reason).report, undefined, 'unreported equal reason is unrelated');
    selected(outer, thrown(mismatch, leftSelection.report), mismatch);
  }
});

test('H04 fanout records multiple exact failures without skipping later subscribers', context => {
  const scope = rig(context);
  const local = scope.controller();
  const boundary = scope.keep(child(scope.root, local, 1));
  const order = [];
  const callbackFailure = { callback: 'failure' };
  const localReason = { cancel: 'local' };
  subscribeCancellation(boundary, origin => { order.push(1); assert.equal(origin.signal, local.signal); throw undefined; });
  subscribeCancellation(boundary, origin => { order.push(2); assert.equal(origin.frame, boundary); });
  subscribeCancellation(boundary, () => { order.push(3); throw callbackFailure; });
  subscribeCancellation(boundary, () => { order.push(4); });
  local.abort(localReason);
  assert.deepEqual(order, [1, 2, 3, 4]);
  selected(boundary, returned(), localReason, local.signal, boundary);
  const closed = boundary.close();
  assert.equal(closed.failures.length, 2);
  assert.equal(closed.failures[0], undefined);
  assert.equal(closed.failures[1], callbackFailure);
  assert.equal(boundary.close(), closed);
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test('H04b detaching one later subscriber does not skip unrelated admitted subscribers', context => {
  const scope = rig(context);
  const local = scope.controller();
  const boundary = scope.keep(child(scope.root, local, 1));
  const seen = [];
  let detachSecond;
  subscribeCancellation(boundary, () => { seen.push('first'); detachSecond(); });
  detachSecond = subscribeCancellation(boundary, () => { seen.push('removed'); });
  subscribeCancellation(boundary, () => { seen.push('third'); });
  local.abort({ cancel: true });
  assert.deepEqual(seen, ['first', 'third'], 'only the detached subscription is skipped');
});

test('H05 borrowed variants allocate no cancellation resources and cannot close parent', context => {
  const scope = rig(context, {}, 2);
  const local = scope.controller();
  const NativeController = globalThis.AbortController;
  let allocations = 0;
  globalThis.AbortController = class extends NativeController { constructor() { super(); allocations++; } };
  let borrowed;
  try {
    borrowed = [admitChildCancellation(scope.root), admitChildCancellation(scope.root, undefined),
      admitChildCancellation(scope.root, {}), admitChildCancellation(scope.root, { signal: undefined })];
    for (const lease of borrowed) {
      assert.equal(lease.owned, false);
      assert.equal(lease.deliverySignal, scope.root.deliverySignal);
      assert.equal(lease.close(), lease.close());
    }
  } finally { globalThis.AbortController = NativeController; }
  assert.equal(allocations, 0);
  const owned = scope.keep(child(scope.root, local, 1, 2));
  assert.equal(getEventListeners(local.signal, 'abort').length, 1);
  owned.close();
  assert.equal(getEventListeners(local.signal, 'abort').length, 0);
  const detach = subscribeCancellation(scope.root, () => {});
  detach();
  assert.equal(caught(() => subscribeCancellation(borrowed[0], () => {})) instanceof TypeError, true);
});

test('H06 admission prioritizes original ancestors and stable closed failure over getter', context => {
  const caller = new AbortController();
  const scope = rig(context, { callerSignal: caller.signal });
  const local = scope.controller();
  const outer = scope.keep(child(scope.root, local, 1));
  let reads = 0;
  const options = { get signal() { reads++; throw { getter: true }; } };
  local.abort(false);
  assert.equal(caught(() => admitChildCancellation(outer, options, bounds(2))), false);
  caller.abort(null);
  assert.equal(caught(() => admitChildCancellation(outer, options, bounds(2))), null);
  assert.equal(reads, 0);
  const other = rig(context);
  const closed = caught(() => admitChildCancellation(other.root, {
    get signal() { reads++; other.root.close(); throw undefined; },
  }, bounds(1)));
  assert.ok(closed instanceof Error);
  assert.equal(caught(() => admitChildCancellation(other.root)), closed);
  assert.equal(reads, 1);
});

test('H07 original control delivery survives invoke selection and root has final priority', context => {
  const caller = new AbortController();
  const control = new AbortController();
  const scope = rig(context, { callerSignal: caller.signal, controls: [{ role: 'pipeline-control', signal: control.signal }] });
  const outerSignal = scope.controller();
  const innerSignal = scope.controller();
  const outer = scope.keep(child(scope.root, outerSignal, 1));
  const inner = scope.keep(child(outer, innerSignal, 2));
  const controlReason = { control: true };
  control.abort(controlReason);
  outerSignal.abort({ invoke: true });
  selected(inner, thrown(controlReason), controlReason, control.signal, scope.root, 'pipeline-control');
  selected(inner, returned(), outerSignal.signal.reason, outerSignal.signal, outer);
  caller.abort({ caller: true });
  selected(inner, thrown(controlReason), caller.signal.reason, caller.signal, scope.root, 'root-caller');
  assert.equal(inner.deliverySignal.reason, controlReason);
});

test('H07b admission uses first delivered control rather than configured array order', context => {
  const configuredFirst = new AbortController();
  const deliveredFirst = new AbortController();
  const scope = rig(context, { controls: [
    { role: 'budget-control', signal: configuredFirst.signal },
    { role: 'pipeline-control', signal: deliveredFirst.signal },
  ] });
  const firstReason = { control: 'delivered first' };
  const secondReason = { control: 'configured first' };
  deliveredFirst.abort(firstReason);
  configuredFirst.abort(secondReason);
  assert.equal(scope.root.deliverySignal.reason, firstReason);
  let reads = 0;
  const failure = caught(() => admitChildCancellation(scope.root, { get signal() { reads++; return undefined; } }));
  assert.equal(reads, 0);
  assert.equal(failure, firstReason, 'declared first-delivered control admission policy');
});

test('H08 capacity and depth denial precede listeners; explicit release restores capacity', context => {
  const scope = rig(context, {}, 2);
  const local = scope.controller();
  const next = scope.controller();
  const owned = scope.keep(child(scope.root, local, 1, 2));
  assert.ok(caught(() => child(scope.root, next, 1, 2)) instanceof CancellationCapacityError);
  assert.equal(getEventListeners(next.signal, 'abort').length, 0);
  assert.ok(caught(() => subscribeCancellation(owned, () => {})) instanceof CancellationCapacityError);
  assert.ok(caught(() => admitChildCancellation(owned, { signal: next.signal }, bounds(9))) instanceof RangeError);
  assert.equal(getEventListeners(next.signal, 'abort').length, 0);
  owned.close();
  const detach = subscribeCancellation(scope.root, () => {});
  assert.ok(caught(() => child(scope.root, next, 1, 2)) instanceof CancellationCapacityError);
  detach(); detach();
  scope.keep(child(scope.root, next, 1, 2));
});

test('H09 failed initialization rolls back acquired root listeners and child subscription', context => {
  const caller = new AbortController();
  const failing = new AbortController();
  const setupFailure = { initialization: true };
  const nativeAdd = failing.signal.addEventListener;
  failing.signal.addEventListener = function (...args) { nativeAdd.apply(this, args); throw setupFailure; };
  assert.equal(caught(() => root({ callerSignal: caller.signal, controls: [{ role: 'budget-control', signal: failing.signal }] })), setupFailure);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(failing.signal, 'abort').length, 0);
  const scope = rig(context, {}, 2);
  assert.equal(caught(() => child(scope.root, failing, 1, 2)), setupFailure);
  assert.equal(getEventListeners(failing.signal, 'abort').length, 0);
  failing.signal.addEventListener = nativeAdd;
  const recovered = scope.keep(child(scope.root, failing, 1, 2));
  recovered.close();
  assert.equal(getEventListeners(failing.signal, 'abort').length, 0);
});

test('H10 reentrant close records in-flight failure and detaches untriggered resources', context => {
  const caller = new AbortController();
  const control = new AbortController();
  const scope = rig(context, { callerSignal: caller.signal, controls: [{ role: 'budget-control', signal: control.signal }] });
  const local = scope.controller();
  const boundary = scope.keep(child(scope.root, local, 1));
  let closeResult;
  const failure = { afterClose: true };
  subscribeCancellation(boundary, origin => {
    assert.equal(origin.signal, local.signal);
    closeResult = boundary.close();
    throw failure;
  });
  subscribeCancellation(boundary, () => assert.fail('close detached later subscriber'));
  local.abort(false);
  assert.equal(boundary.close(), closeResult);
  assert.deepEqual(closeResult.failures, [failure]);
  selected(boundary, returned(), false, local.signal, boundary);
  scope.root.close();
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(control.signal, 'abort').length, 0);
  caller.abort({ late: true });
  selected(boundary, returned(), false, local.signal, boundary);
});
