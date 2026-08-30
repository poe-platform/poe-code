import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const { createRootCancellationLink, prepareChildCancellation, activateChildCancellation,
  subscribeCancellation, selectRuntimeCancellationOutcome } = await import(pathToFileURL(process.env.CANCELLATION_MODULE).href);
const bounds = depth => ({ depth, maxDepth: 8, resourceLimit: 24 });
const thrown = (reason, report) => ({ kind: 'throw', reason, report });
const returned = (value = 17) => ({ kind: 'return', value });
function exact(selection, reason, origin) {
  assert.equal(selection.outcome.kind, 'throw');
  assert.ok(Object.is(selection.outcome.reason, reason), 'exact selected failure');
  if (origin) {
    assert.equal(selection.report?.origin.signal, origin.signal, 'original control signal');
    assert.equal(selection.report?.origin.frame, origin.frame, 'original control frame');
    assert.equal(selection.report?.origin.role, origin.role, 'original control role');
  }
  return selection;
}
function scenario(context, role) {
  const caller = new AbortController();
  const control = new AbortController();
  const invoke = new AbortController();
  const local = new AbortController();
  const siblingSignal = new AbortController();
  const root = createRootCancellationLink({ admission: bounds(0), callerSignal: caller.signal });
  const frame = activateChildCancellation(prepareChildCancellation(root, undefined, bounds(1), [{ role, signal: control.signal }]));
  const outer = activateChildCancellation(prepareChildCancellation(frame, { signal: invoke.signal }, bounds(2)));
  const inner = activateChildCancellation(prepareChildCancellation(outer, { signal: local.signal }, bounds(3)));
  const sibling = activateChildCancellation(prepareChildCancellation(root, { signal: siblingSignal.signal }, bounds(1)));
  let observed;
  let siblingOrigin;
  subscribeCancellation(frame, origin => { if (origin.role === role) observed ??= origin; });
  subscribeCancellation(sibling, origin => { siblingOrigin ??= origin; });
  context.after(() => {
    for (const boundary of [inner, outer, frame, sibling, root]) boundary.close();
    for (const controller of [caller, control, invoke, local, siblingSignal]) assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'owned listeners detached');
  });
  return { caller, control, invoke, local, siblingSignal, root, frame, outer, inner, sibling,
    get observed() { return observed; }, get siblingOrigin() { return siblingOrigin; } };
}

test('N1 control-first and invoke-first preserve original control through both authenticated routes', context => {
  for (const [role, controlFirst] of [['budget-control', true], ['pipeline-control', false]]) {
    const scope = scenario(context, role);
    if (controlFirst) { scope.control.abort('control-failure'); scope.invoke.abort('invoke-cancel'); }
    else { scope.invoke.abort('invoke-cancel'); scope.control.abort('control-failure'); }
    assert.equal(scope.inner.deliverySignal.reason, controlFirst ? 'control-failure' : 'invoke-cancel', 'immutable delivery follows actual first observation');
    assert.equal(scope.observed.signal, scope.control.signal);
    assert.equal(scope.observed.frame, scope.frame);
    const selected = exact(selectRuntimeCancellationOutcome(scope.inner, thrown('control-failure'), scope.observed), 'control-failure', scope.observed);
    assert.ok(selected.report);
    exact(selectRuntimeCancellationOutcome(scope.outer, thrown('control-failure', selected.report)), 'control-failure', scope.observed);
    exact(selectRuntimeCancellationOutcome(scope.inner, returned()), 'invoke-cancel');
    assert.deepEqual(selectRuntimeCancellationOutcome(scope.frame, returned()).outcome, returned(), 'child invoke and control failure do not replace ancestor return');
    scope.caller.abort('actual-root');
    exact(selectRuntimeCancellationOutcome(scope.inner, thrown('control-failure'), scope.observed), 'actual-root');
    exact(selectRuntimeCancellationOutcome(scope.outer, thrown('control-failure', selected.report)), 'actual-root');
  }
});

test('N2 false and NaN control reports do not authenticate unrelated or sibling throws', context => {
  for (const reason of [false, NaN]) {
    const scope = scenario(context, 'pipeline-control');
    scope.control.abort(reason);
    scope.invoke.abort('outer-invoke');
    scope.siblingSignal.abort(reason);
    const selected = exact(selectRuntimeCancellationOutcome(scope.inner, thrown(reason), scope.observed), reason, scope.observed);
    exact(selectRuntimeCancellationOutcome(scope.outer, thrown(reason, selected.report)), reason, scope.observed);
    assert.equal(exact(selectRuntimeCancellationOutcome(scope.inner, thrown(reason)), reason).report, undefined, 'equal reason alone is unrelated');
    assert.equal(exact(selectRuntimeCancellationOutcome(scope.inner, thrown(reason), scope.siblingOrigin), reason).report, undefined, 'authentic sibling origin has wrong lineage');
    assert.equal(exact(selectRuntimeCancellationOutcome(scope.sibling, thrown(reason, selected.report)), reason).report, undefined, 'authentic report has wrong target');
    const unrelated = Object.freeze({ unrelated: true });
    assert.equal(exact(selectRuntimeCancellationOutcome(scope.inner, thrown(unrelated), scope.observed), unrelated).report, undefined, 'origin reason mismatch remains exact unrelated error');
    assert.equal(exact(selectRuntimeCancellationOutcome(scope.outer, thrown(unrelated, selected.report)), unrelated).report, undefined, 'report reason mismatch remains unrelated');
    assert.deepEqual(selectRuntimeCancellationOutcome(scope.root, returned()).outcome, returned(), 'no parent outcome poisoning');
  }
});
