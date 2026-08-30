import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const api = await import(pathToFileURL(process.env.CANCELLATION_MODULE).href);
const { createRootCancellationLink, admitChildCancellation, prepareChildCancellation,
  activateChildCancellation, subscribeCancellation, selectCancellationOutcome,
  selectRuntimeCancellationOutcome, CancellationCapacityError } = api;
const bounds = (depth, resourceLimit = 24) => ({ depth, maxDepth: 8, resourceLimit });
const returned = (value = 23) => ({ kind: 'return', value });
const thrown = (reason, report) => ({ kind: 'throw', reason, report });

function caught(operation) {
  let didThrow = false;
  let reason;
  try { operation(); } catch (error) { didThrow = true; reason = error; }
  assert.equal(didThrow, true, 'operation must throw');
  return reason;
}

function exact(selection, reason, origin) {
  assert.equal(selection.outcome.kind, 'throw');
  assert.ok(Object.is(selection.outcome.reason, reason), 'exact selected reason');
  if (origin) {
    assert.equal(selection.report?.origin.signal, origin.signal, 'original signal');
    assert.equal(selection.report?.origin.frame, origin.frame, 'original frame');
    assert.equal(selection.report?.origin.role, origin.role, 'original role');
  }
  return selection;
}

function rig(context) {
  const boundaries = [];
  const signals = [];
  context.after(() => {
    for (const boundary of [...boundaries].reverse()) boundary.close();
    for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0, 'no retained abort listeners');
  });
  return {
    controller() { const controller = new AbortController(); signals.push(controller.signal); return controller; },
    keep(boundary) { boundaries.push(boundary); return boundary; },
    root(extra = {}, resourceLimit = 24) {
      return this.keep(createRootCancellationLink({ admission: bounds(0, resourceLimit), ...extra }));
    },
    activate(prepared) { return this.keep(activateChildCancellation(prepared)); },
  };
}

function acquisitionTrace(signals, operation) {
  const NativeController = globalThis.AbortController;
  const events = [];
  const descriptors = signals.map(signal => Object.getOwnPropertyDescriptor(signal, 'addEventListener'));
  const methods = signals.map(signal => signal.addEventListener);
  try {
    globalThis.AbortController = class extends NativeController {
      constructor() { super(); events.push('controller'); }
    };
    signals.forEach((signal, index) => {
      signal.addEventListener = function (...args) {
        events.push('listener');
        return methods[index].apply(this, args);
      };
    });
    return operation(events);
  } finally {
    globalThis.AbortController = NativeController;
    signals.forEach((signal, index) => {
      if (descriptors[index]) Object.defineProperty(signal, 'addEventListener', descriptors[index]);
      else delete signal.addEventListener;
    });
  }
}

function replay(prepared) {
  const first = caught(() => activateChildCancellation(prepared));
  assert.ok(first instanceof Error, 'stable replay error');
  assert.equal(caught(() => activateChildCancellation(prepared)), first, 'same replay error');
}

test('E01 inert read-once preparation copies inputs and reserves nothing', context => {
  const scope = rig(context);
  const parent = scope.root({}, 2);
  const local = scope.controller();
  const control = scope.controller();
  const replacement = scope.controller();
  let reads = 0;
  const options = { get signal() { reads += 1; return reads === 1 ? local.signal : replacement.signal; } };
  const snapshot = bounds(1, 3);
  const controls = [{ role: 'pipeline-control', signal: control.signal }];
  const prepared = acquisitionTrace([local.signal, control.signal], events => {
    const value = prepareChildCancellation(parent, options, snapshot, controls);
    assert.deepEqual(events, [], 'preparation must acquire no resources');
    return value;
  });
  assert.equal(prepared.owned, true);
  assert.equal(reads, 1);
  assert.equal(getEventListeners(local.signal, 'abort').length, 0);
  assert.equal(getEventListeners(control.signal, 'abort').length, 0);
  const sibling = scope.keep(admitChildCancellation(parent, { signal: replacement.signal }, bounds(1, 2)));
  sibling.close();
  snapshot.depth = -1;
  snapshot.resourceLimit = 0;
  controls[0].signal = replacement.signal;
  controls.length = 0;
  const child = scope.activate(prepared);
  assert.equal(reads, 1, 'activation does not read options again');
  assert.equal(getEventListeners(local.signal, 'abort').length, 1);
  assert.equal(getEventListeners(control.signal, 'abort').length, 1);
  control.abort('copied-control');
  assert.equal(child.deliverySignal.reason, 'copied-control');
});

test('E02 ancestor/getter/closed admission precedence is inert and exact', context => {
  const scope = rig(context);
  const caller = scope.controller();
  const parent = scope.root({ callerSignal: caller.signal });
  const local = scope.controller();
  for (const options of [null, 0, 'bad', { signal: {} }, { signal: local }]) {
    acquisitionTrace([local.signal], events => {
      assert.ok(caught(() => prepareChildCancellation(parent, options, bounds(1))) instanceof TypeError);
      assert.deepEqual(events, []);
    });
  }
  assert.equal(caught(() => prepareChildCancellation(parent, { get signal() { throw undefined; } }, bounds(1))), undefined);
  acquisitionTrace([local.signal], events => {
    caught(() => prepareChildCancellation(parent, { signal: local.signal }, bounds(0)));
    assert.deepEqual(events, []);
  });
  let reads = 0;
  caller.abort(false);
  assert.equal(caught(() => prepareChildCancellation(parent, { get signal() { reads += 1; throw 'getter'; } })), false);
  assert.equal(reads, 0);
  const closing = scope.root();
  const closed = caught(() => prepareChildCancellation(closing, { get signal() { closing.close(); throw 'getter'; } }));
  assert.ok(closed instanceof Error);
  assert.equal(caught(() => prepareChildCancellation(closing)), closed, 'stable closed admission outranks getter');
});

test('E03 TEST-LOCAL registrar precedes activation acquisition', context => {
  const scope = rig(context);
  const parent = scope.root({}, 2);
  const local = scope.controller();
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  let child;
  let cleanup;
  let closeResult;
  acquisitionTrace([local.signal], events => {
    const register = callback => { events.push('registered'); cleanup = callback; };
    register(() => { if (child) closeResult ??= child.close(); return closeResult; });
    child = scope.activate(prepared);
    assert.equal(events[0], 'registered');
    assert.ok(events.includes('controller'));
    assert.ok(events.includes('listener'));
    assert.equal(cleanup(), cleanup());
  });
  assert.equal(getEventListeners(local.signal, 'abort').length, 0);
  const unused = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  const failure = { registration: true };
  acquisitionTrace([local.signal], events => {
    const register = () => { throw failure; };
    assert.equal(caught(() => { register(); scope.activate(unused); }), failure);
    assert.deepEqual(events, []);
  });
  scope.activate(unused).close();
});

test('E04 activation rechecks parent closure abort and local/control order', context => {
  for (const mode of ['closed', 'ancestor', 'local', 'controls']) {
    const scope = rig(context);
    const caller = scope.controller();
    const parent = scope.root({ callerSignal: caller.signal });
    const local = scope.controller();
    const first = scope.controller();
    const second = scope.controller();
    const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1), [
      { role: 'pipeline-control', signal: first.signal },
      { role: 'budget-control', signal: second.signal },
    ]);
    let expected;
    if (mode === 'closed') {
      parent.close();
      expected = caught(() => prepareChildCancellation(parent));
    } else {
      second.abort('configured-second');
      first.abort('configured-first');
      expected = 'configured-first';
      if (mode !== 'controls') { local.abort(false); expected = false; }
      if (mode === 'ancestor') { caller.abort(null); expected = null; }
    }
    acquisitionTrace([local.signal, first.signal, second.signal], events => {
      assert.ok(Object.is(caught(() => activateChildCancellation(prepared)), expected), `${mode} exact failure`);
      assert.deepEqual(events, [], 'failed recheck must precede resource acquisition');
      replay(prepared);
      assert.deepEqual(events, []);
    });
  }
});

test('E05 owned borrowed and failed preparations are single-use', context => {
  const scope = rig(context);
  const parent = scope.root();
  const local = scope.controller();
  for (const options of [undefined, { signal: local.signal }]) {
    const prepared = prepareChildCancellation(parent, options, bounds(1));
    const boundary = scope.activate(prepared);
    acquisitionTrace([local.signal], events => { replay(prepared); assert.deepEqual(events, []); });
    boundary.close();
    replay(prepared);
  }
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1));
  local.abort('first-failure');
  assert.equal(caught(() => activateChildCancellation(prepared)), 'first-failure');
  replay(prepared);
});

test('E06 no-control omitted and undefined preparations borrow without resources', context => {
  const scope = rig(context);
  const parent = scope.root({}, 1);
  for (const options of [undefined, {}, { signal: undefined }]) {
    acquisitionTrace([], events => {
      const prepared = prepareChildCancellation(parent, options, { depth: -1, maxDepth: -1, resourceLimit: -1 }, undefined);
      assert.equal(prepared.owned, false);
      const borrowed = scope.activate(prepared);
      assert.equal(borrowed.owned, false);
      assert.equal(borrowed.deliverySignal, parent.deliverySignal);
      borrowed.close();
      assert.deepEqual(events, []);
      const again = scope.activate(prepareChildCancellation(parent));
      assert.equal(again.owned, false, 'borrowed close leaves parent open');
    });
  }
  scope.activate(prepareChildCancellation(parent, undefined, undefined, [])).close();
});

test('E07 nested original controls inherit lineage without inventing invoke rank', context => {
  const scope = rig(context);
  const caller = scope.controller();
  const parent = scope.root({ callerSignal: caller.signal });
  const outerSignal = scope.controller();
  const outer = scope.activate(prepareChildCancellation(parent, { signal: outerSignal.signal }, bounds(1)));
  const controlA = scope.controller();
  const controlB = scope.controller();
  const stage = scope.activate(prepareChildCancellation(outer, undefined, bounds(2), [
    { role: 'pipeline-control', signal: controlA.signal },
    { role: 'budget-control', signal: controlB.signal },
  ]));
  const innerSignal = scope.controller();
  const inner = scope.activate(prepareChildCancellation(stage, { signal: innerSignal.signal }, bounds(3)));
  let observed;
  subscribeCancellation(inner, origin => { observed ??= origin; });
  controlB.abort('live-first-B');
  controlA.abort('later-A');
  assert.equal(observed.signal, controlB.signal);
  assert.equal(observed.frame, stage);
  assert.equal(observed.role, 'budget-control');
  assert.deepEqual(selectRuntimeCancellationOutcome(stage, returned()).outcome, returned(), 'control-only frame has no invoke rank');
  let reads = 0;
  assert.equal(caught(() => prepareChildCancellation(inner, { get signal() { reads += 1; return undefined; } })), 'live-first-B');
  assert.equal(reads, 0);
  outerSignal.abort('outer-rank');
  exact(selectRuntimeCancellationOutcome(inner, returned()), 'outer-rank', { signal: outerSignal.signal, frame: outer, role: 'invoke-option' });
  exact(selectRuntimeCancellationOutcome(inner, thrown('live-first-B'), observed), 'live-first-B', observed);
  assert.equal(inner.deliverySignal.reason, 'live-first-B');
  caller.abort('root-rank');
  exact(selectRuntimeCancellationOutcome(inner, thrown('unrelated')), 'root-rank');
});

test('E08 runtime selector distinguishes authentic observation from equal falsy rejection', async context => {
  for (const reason of [undefined, null, false, 0, -0, '', NaN]) {
    const scope = rig(context);
    const caller = scope.controller();
    const parent = scope.root({ callerSignal: caller.signal });
    const outerSignal = scope.controller();
    const outer = scope.activate(prepareChildCancellation(parent, { signal: outerSignal.signal }, bounds(1)));
    const local = scope.controller();
    const inner = scope.activate(prepareChildCancellation(outer, { signal: local.signal }, bounds(2)));
    let observed;
    subscribeCancellation(inner, origin => { observed ??= origin; });
    if (reason === undefined) Object.defineProperty(local.signal, 'reason', { value: undefined, configurable: true });
    local.abort(reason === undefined ? 'native-owned-reason-fixture' : reason);
    outerSignal.abort('outer');
    const escaped = await (async () => { throw reason; })().then(() => assert.fail('must reject'), value => thrown(value));
    const unrelated = exact(selectRuntimeCancellationOutcome(inner, escaped), reason);
    assert.equal(unrelated.report, undefined, 'equal rejection is not provenance');
    exact(selectRuntimeCancellationOutcome(inner, escaped, observed), 'outer', { signal: outerSignal.signal, frame: outer, role: 'invoke-option' });
    exact(selectCancellationOutcome(inner, escaped), 'outer', { signal: outerSignal.signal, frame: outer, role: 'invoke-option' });
    caller.abort('root');
    exact(selectRuntimeCancellationOutcome(inner, escaped), 'root');
  }
});

test('E09 authenticated descendant reports require exact target and reason', context => {
  const scope = rig(context);
  const parent = scope.root();
  const outerSignal = scope.controller();
  const outer = scope.activate(prepareChildCancellation(parent, { signal: outerSignal.signal }, bounds(1)));
  const siblingSignal = scope.controller();
  const sibling = scope.activate(prepareChildCancellation(parent, { signal: siblingSignal.signal }, bounds(1)));
  const local = scope.controller();
  const inner = scope.activate(prepareChildCancellation(outer, { signal: local.signal }, bounds(2)));
  let observed;
  subscribeCancellation(inner, origin => { observed = origin; });
  local.abort(false);
  const selected = exact(selectRuntimeCancellationOutcome(inner, thrown(false), observed), false, observed);
  assert.ok(selected.report);
  const forwarded = exact(selectRuntimeCancellationOutcome(outer, thrown(false, selected.report)), false, observed);
  assert.ok(forwarded.report);
  assert.equal(exact(selectRuntimeCancellationOutcome(sibling, thrown(false, selected.report)), false).report, undefined);
  assert.equal(exact(selectRuntimeCancellationOutcome(outer, thrown(0, selected.report)), 0).report, undefined);
  assert.equal(exact(selectRuntimeCancellationOutcome(outer, thrown(false)), false).report, undefined);
  assert.deepEqual(selectRuntimeCancellationOutcome(parent, returned()).outcome, returned());
});

test('E10 close fixes selection and retains exact ordered callback failures', context => {
  const scope = rig(context);
  const caller = scope.controller();
  const parent = scope.root({ callerSignal: caller.signal });
  const local = scope.controller();
  const dormant = scope.controller();
  const child = scope.activate(prepareChildCancellation(parent, { signal: local.signal }, bounds(1), [{ role: 'pipeline-control', signal: dormant.signal }]));
  const failure = { exact: 'callback' };
  subscribeCancellation(child, () => { throw undefined; });
  subscribeCancellation(child, () => { throw failure; });
  let delivered;
  subscribeCancellation(child, origin => { delivered = origin; });
  local.abort(false);
  const close = child.close();
  assert.equal(child.close(), close);
  assert.deepEqual(close.failures, [undefined, failure]);
  assert.equal(getEventListeners(dormant.signal, 'abort').length, 0);
  caller.abort('late-root');
  dormant.abort('late-control');
  exact(selectRuntimeCancellationOutcome(child, returned()), false, delivered);
  assert.equal(child.deliverySignal.reason, false);
  assert.equal(child.close(), close);
});

test('E11 failed activation rolls back admitted listeners and parent capacity', context => {
  const scope = rig(context);
  const parent = scope.root({}, 2);
  const local = scope.controller();
  const control = scope.controller();
  const prepared = prepareChildCancellation(parent, { signal: local.signal }, bounds(1), [{ role: 'pipeline-control', signal: control.signal }]);
  const nativeAdd = control.signal.addEventListener;
  const failure = { initialization: true };
  control.signal.addEventListener = function (...args) { nativeAdd.apply(this, args); throw failure; };
  try { assert.equal(caught(() => activateChildCancellation(prepared)), failure); }
  finally { delete control.signal.addEventListener; }
  assert.equal(getEventListeners(local.signal, 'abort').length, 0, 'rollback local listener');
  assert.equal(getEventListeners(control.signal, 'abort').length, 0, 'rollback throwing listener');
  replay(prepared);
  const recovered = scope.activate(prepareChildCancellation(parent, { signal: local.signal }, bounds(1), [{ role: 'pipeline-control', signal: control.signal }]));
  recovered.close();
});

test('E12 preparation does not reserve capacity and activation rechecks bounds', context => {
  const scope = rig(context);
  const parent = scope.root({}, 2);
  const local = scope.controller();
  const control = scope.controller();
  assert.ok(caught(() => prepareChildCancellation(parent, { signal: local.signal }, bounds(1, 2), [{ role: 'pipeline-control', signal: control.signal }])) instanceof CancellationCapacityError);
  const first = prepareChildCancellation(parent, undefined, bounds(1, 2), [{ role: 'pipeline-control', signal: control.signal }]);
  const second = prepareChildCancellation(parent, { signal: local.signal }, bounds(1, 2));
  const active = scope.activate(first);
  acquisitionTrace([local.signal], events => {
    assert.ok(caught(() => activateChildCancellation(second)) instanceof CancellationCapacityError);
    assert.deepEqual(events, [], 'capacity recheck before allocation');
  });
  replay(second);
  active.close();
  scope.activate(prepareChildCancellation(parent, { signal: local.signal }, bounds(1, 2))).close();
});
