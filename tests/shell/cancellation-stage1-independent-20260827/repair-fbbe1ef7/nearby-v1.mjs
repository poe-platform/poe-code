import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const { createRootCancellationLink, admitChildCancellation, subscribeCancellation, selectCancellationOutcome } =
  await import(pathToFileURL(process.env.CANCELLATION_MODULE).href);
const bounds = depth => ({ depth, maxDepth: 8, resourceLimit: 24 });
const returned = (value = 17) => ({ kind: 'return', value });
const thrown = (reason, report) => ({ kind: 'throw', reason, report });
function caught(operation) {
  let didThrow = false;
  let reason;
  try { operation(); } catch (error) { didThrow = true; reason = error; }
  assert.equal(didThrow, true);
  return reason;
}
function scope(context) {
  const boundaries = [];
  const signals = [];
  context.after(() => {
    for (const boundary of [...boundaries].reverse()) boundary.close();
    for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0, 'no retained owned abort listener');
  });
  return {
    controller() { const controller = new AbortController(); signals.push(controller.signal); return controller; },
    root(extra = {}) { const boundary = createRootCancellationLink({ admission: bounds(0), ...extra }); boundaries.push(boundary); return boundary; },
    child(parent, controller, depth) {
      const boundary = admitChildCancellation(parent, { signal: controller.signal }, bounds(depth));
      boundaries.push(boundary); return boundary;
    },
  };
}
function selection(boundary, captured, reason, origin) {
  const result = selectCancellationOutcome(boundary, captured);
  assert.equal(result.outcome.kind, 'throw');
  assert.ok(Object.is(result.outcome.reason, reason));
  if (origin) {
    assert.equal(result.report?.origin.signal, origin.signal, 'original signal');
    assert.equal(result.report?.origin.frame, origin.frame, 'original frame');
    assert.equal(result.report?.origin.role, origin.role, 'original role');
  }
  return result;
}

test('N1 child-close and self-unsubscribe skip only removed forwarders; whole close stops fanout', context => {
  const resources = scope(context);
  const caller = resources.controller();
  const parent = resources.root({ callerSignal: caller.signal });
  let removedChild;
  let detachFirst;
  const failure = { callback: 'after-detach' };
  const order = [];
  detachFirst = subscribeCancellation(parent, () => {
    order.push('first');
    removedChild.close();
    detachFirst();
    throw failure;
  });
  removedChild = resources.child(parent, resources.controller(), 1);
  const retainedChild = resources.child(parent, resources.controller(), 1);
  subscribeCancellation(retainedChild, origin => {
    order.push('retained-child');
    assert.equal(origin.signal, caller.signal);
    assert.equal(origin.frame, parent);
  });
  const reason = { caller: 'cancel' };
  caller.abort(reason);
  assert.deepEqual(order, ['first', 'retained-child']);
  assert.equal(removedChild.deliverySignal.aborted, false);
  assert.equal(retainedChild.deliverySignal.reason, reason);
  selection(retainedChild, returned(), reason, { signal: caller.signal, frame: parent, role: 'root-caller' });
  assert.deepEqual(parent.close().failures, [failure]);

  const wholeCaller = resources.controller();
  const whole = resources.root({ callerSignal: wholeCaller.signal });
  let closed;
  subscribeCancellation(whole, () => { closed = whole.close(); throw undefined; });
  const stoppedChild = resources.child(whole, resources.controller(), 1);
  subscribeCancellation(whole, () => assert.fail('whole close must stop later fanout'));
  wholeCaller.abort({ whole: true });
  assert.equal(stoppedChild.deliverySignal.aborted, false);
  assert.equal(whole.close(), closed);
  assert.deepEqual(closed.failures, [undefined]);
});

test('N2 borrowed close and parent close preserve original descendant control and cleanup', context => {
  const resources = scope(context);
  const caller = resources.controller();
  const control = resources.controller();
  const parent = resources.root({ callerSignal: caller.signal, controls: [{ role: 'budget-control', signal: control.signal }] });
  const outer = resources.child(parent, resources.controller(), 1);
  const inner = resources.child(outer, resources.controller(), 2);
  const beforeDeliveryListeners = getEventListeners(inner.deliverySignal, 'abort').length;
  const lease = admitChildCancellation(inner, { signal: undefined });
  assert.equal(lease.owned, false);
  assert.equal(lease.deliverySignal, inner.deliverySignal);
  assert.equal(getEventListeners(inner.deliverySignal, 'abort').length, beforeDeliveryListeners);
  lease.close();
  const detach = subscribeCancellation(inner, () => {});
  detach();
  const reason = { control: 'first' };
  control.abort(reason);
  const parentClose = outer.close();
  const original = { signal: control.signal, frame: parent, role: 'budget-control' };
  selection(inner, thrown(reason), reason, original);
  selection(lease, thrown(reason), reason, original);
  let getterReads = 0;
  assert.equal(caught(() => admitChildCancellation(outer, { get signal() { getterReads++; return undefined; } })), reason);
  assert.equal(getterReads, 0);
  assert.equal(outer.close(), parentClose);
  const closed = inner.close();
  caller.abort({ root: 'late' });
  selection(inner, thrown(reason), reason, original);
  selection(lease, thrown(reason), reason, original);
  assert.equal(inner.close(), closed);
  parent.close();
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('N3 observed B-before-A admission stays separate from invoke and root settlement ranks', context => {
  const resources = scope(context);
  const caller = resources.controller();
  const configuredFirst = resources.controller();
  const observedFirst = resources.controller();
  const parent = resources.root({ callerSignal: caller.signal, controls: [
    { role: 'budget-control', signal: configuredFirst.signal },
    { role: 'pipeline-control', signal: observedFirst.signal },
  ] });
  const invoke = resources.controller();
  const child = resources.child(parent, invoke, 1);
  const descendant = resources.child(child, resources.controller(), 2);
  const lease = admitChildCancellation(descendant);
  const reasonB = { sameMessage: 'control' };
  const reasonA = { sameMessage: 'control' };
  const trace = [];
  subscribeCancellation(parent, origin => { trace.push(origin.signal); });
  observedFirst.abort(reasonB);
  configuredFirst.abort(reasonA);
  assert.equal(trace[0], observedFirst.signal);
  let getterReads = 0;
  for (const boundary of [parent, descendant, lease]) {
    assert.equal(caught(() => admitChildCancellation(boundary, { get signal() { getterReads++; return undefined; } })), reasonB);
  }
  assert.equal(getterReads, 0);
  const original = { signal: observedFirst.signal, frame: parent, role: 'pipeline-control' };
  const controlSelection = selection(descendant, thrown(reasonB), reasonB, original);
  selection(child, thrown(reasonB, controlSelection.report), reasonB, original);
  invoke.abort({ invoke: 'higher-ranked' });
  assert.equal(caught(() => admitChildCancellation(lease)), invoke.signal.reason);
  selection(descendant, returned(), invoke.signal.reason, { signal: invoke.signal, frame: child, role: 'invoke-option' });
  selection(descendant, thrown(reasonB), reasonB, original);
  caller.abort({ root: 'highest-ranked' });
  selection(descendant, thrown(reasonA), caller.signal.reason, { signal: caller.signal, frame: parent, role: 'root-caller' });
  assert.equal(caught(() => admitChildCancellation(lease)), caller.signal.reason);
  assert.equal(descendant.deliverySignal.reason, reasonB);
  lease.close();
});

test('N4 pre-observation multiple aborts use configured fallback without historical-order inference', context => {
  for (const abortOrder of ['A-then-B', 'B-then-A']) {
    const resources = scope(context);
    const configuredFirst = resources.controller();
    const configuredSecond = resources.controller();
    const reasonA = { control: 'configured-first', abortOrder };
    const reasonB = { control: 'configured-second', abortOrder };
    if (abortOrder === 'A-then-B') { configuredFirst.abort(reasonA); configuredSecond.abort(reasonB); }
    else { configuredSecond.abort(reasonB); configuredFirst.abort(reasonA); }
    const parent = resources.root({ controls: [
      { role: 'budget-control', signal: configuredFirst.signal },
      { role: 'pipeline-control', signal: configuredSecond.signal },
    ] });
    assert.equal(parent.deliverySignal.reason, reasonA, 'configured fallback, not reconstructed host chronology');
    let getterReads = 0;
    assert.equal(caught(() => admitChildCancellation(parent, { get signal() { getterReads++; return undefined; } })), reasonA);
    assert.equal(getterReads, 0);
    selection(parent, thrown(reasonB), reasonB);
    assert.deepEqual(selectCancellationOutcome(parent, returned()).outcome, returned());
    assert.equal(getEventListeners(configuredFirst.signal, 'abort').length, 0);
    assert.equal(getEventListeners(configuredSecond.signal, 'abort').length, 0);
    const close = parent.close();
    assert.equal(parent.close(), close);
  }
});
