import assert from 'node:assert/strict';

export function observeSettlement(promise) {
  let state = Object.freeze({ status: 'pending' });
  const settled = Promise.resolve(promise).then(
    value => { state = Object.freeze({ status: 'fulfilled', value }); return state; },
    reason => { state = Object.freeze({ status: 'rejected', reason }); return state; },
  );
  return Object.freeze({ snapshot: () => state, settled });
}

export function controlledLatch() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  const observation = observeSettlement(promise);
  return Object.freeze({ promise, resolve, reject, observation });
}

function closed(receipt) {
  assert.equal(receipt.selectedChildClosed, true, 'SELECTED_CHILD_NOT_CLOSED');
  assert.equal(receipt.retirementSettled, true, 'RETIREMENT_NOT_SETTLED');
  assert.equal(receipt.outstandingOwnedResources, 0, 'OWNED_RESOURCES_REMAIN');
  assert.equal(receipt.rejectionsObserved, true, 'REJECTIONS_NOT_OBSERVED');
}

export function assertCallerCollision(receipt) {
  assert.equal(receipt.localSignal.aborted, true, 'OWN_DEADLINE_NOT_OBSERVED');
  assert.equal(receipt.callerSignal.aborted, true, 'CALLER_ABORT_NOT_ACTIVATED');
  assert.notEqual(receipt.localSignal, receipt.callerSignal, 'CALLER_IS_NOT_DISTINCT');
  assert.ok(Object.is(receipt.observedOwnReason, receipt.localSignal.reason), 'WRONG_OWN_REASON');
  assert.ok(Object.is(receipt.callerSignal.reason, receipt.observedOwnReason), 'NOT_SAME_SENTINEL');
  assert.equal(receipt.beforeRelease.handler.status, 'pending', 'HANDLER_SETTLED_BEFORE_CLOSURE');
  assert.equal(receipt.beforeRelease.outer.status, 'pending', 'OUTER_SETTLED_BEFORE_CLOSURE');
  assert.equal(receipt.handler.status, 'rejected', 'HANDLER_RETURNED_STATUS');
  assert.ok(Object.is(receipt.handler.reason, receipt.callerSignal.reason), 'WRONG_HANDLER_CALLER_REASON');
  assert.equal(receipt.outer.status, 'rejected', 'OUTER_RETURNED_STATUS');
  assert.ok(Object.is(receipt.outer.reason, receipt.callerSignal.reason), 'WRONG_OUTER_CALLER_REASON');
  closed(receipt);
  return Object.freeze({ status: 'RECEIPT_MATCHES', productActivationProvedByThisPredicate: false });
}

export class HoldoutUnactivated extends Error {
  constructor() { super('PC02 actual product-owned retirement throw not activated'); this.code = 'HOLD_UNACTIVATED'; }
}

export function assertDirectRetirementCollision(receipt) {
  if (receipt.retirement?.origin !== 'product-owned-scheduler-retirement' || receipt.retirement.entered !== true || receipt.retirement.threw !== true) throw new HoldoutUnactivated();
  assert.equal(receipt.localSignal.aborted, true, 'OWN_DEADLINE_NOT_OBSERVED');
  assert.ok(Object.is(receipt.observedOwnReason, receipt.localSignal.reason), 'WRONG_OWN_REASON');
  assert.ok(Object.is(receipt.retirement.reason, receipt.observedOwnReason), 'RETIREMENT_NOT_SAME_SENTINEL');
  assert.equal(receipt.beforeRelease.handler.status, 'pending', 'HANDLER_SETTLED_BEFORE_CLOSURE');
  assert.equal(receipt.handler.status, 'rejected', 'RETIREMENT_MAPPED_TO_STATUS');
  assert.ok(Object.is(receipt.handler.reason, receipt.retirement.reason), 'RETIREMENT_IDENTITY_LOST');
  closed(receipt);
  return Object.freeze({ status: 'DIRECT_RECEIPT_MATCHES', shellAggregationCovered: false, productActivationProvedByThisPredicate: false });
}

export const factoryNames = Object.freeze(['createTimeoutCommand', 'createTimeoutCommands', 'timeoutCommands']);

export function probeFactorySurface(module) {
  assert.deepEqual(Object.keys(module).sort(), [...factoryNames]);
  for (const name of factoryNames) assert.equal(typeof module[name], 'function');
  const first = module.createTimeoutCommand(), second = module.createTimeoutCommand();
  assert.notEqual(first, second);
  for (const definition of [first, second]) { assert.equal(definition.name, 'timeout'); assert.equal(Object.isFrozen(definition), true); }
  const firstFamily = module.createTimeoutCommands(), secondFamily = module.createTimeoutCommands();
  assert.notEqual(firstFamily, secondFamily);
  assert.notEqual(firstFamily[0], secondFamily[0]);
  for (const definitions of [firstFamily, secondFamily]) {
    assert.ok(Array.isArray(definitions)); assert.equal(definitions.length, 1); assert.equal(Object.isFrozen(definitions), true);
    assert.equal(definitions[0].name, 'timeout'); assert.equal(Object.isFrozen(definitions[0]), true);
  }
  const firstPlugin = module.timeoutCommands(), secondPlugin = module.timeoutCommands();
  assert.notEqual(firstPlugin, secondPlugin);
  assert.equal(firstPlugin.name, 'timeout-commands'); assert.equal(secondPlugin.name, 'timeout-commands');
  return Object.freeze({ family: 'F01', scope: 'runtime-factory-shape-only', typeOrRegistryProof: false });
}

export function probeFactoryContainers(module) {
  const rejected = [null, false, 0, 'string', 1n, Symbol('invalid-container'), () => {}, []];
  const records = [];
  class Options {}
  for (const name of factoryNames) {
    for (const value of rejected) assert.throws(() => module[name](value), TypeError);
    module[name]();
    const unknownGetter = Object.create(null, { ignored: { get() { throw new Error('UNKNOWN_OPTION_READ'); } } });
    const nonEnumerated = new Proxy({}, { ownKeys() { throw new Error('OPTIONS_ENUMERATED'); } });
    for (const value of [undefined, {}, Object.create(null), new Options(), unknownGetter, nonEnumerated]) module[name](value);
    records.push({ name, invalidContainersRejected: rejected.length, validContainerCalls: 7 });
  }
  return Object.freeze({ family: 'F02', scope: 'container-and-unknown-property-probes', records, otherFactoryPoliciesCovered: false });
}
