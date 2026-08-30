import assert from 'node:assert/strict';
import { controlledLatch, observeSettlement, assertCallerCollision, assertDirectRetirementCollision, HoldoutUnactivated, probeFactorySurface, probeFactoryContainers } from './support.mjs';

function syntheticReceipt() {
  const reason = Object.freeze({ name: 'fixture-deadline', code: 'fixture-only' });
  const local = new AbortController(), caller = new AbortController();
  local.abort(reason); caller.abort(reason);
  return { classification: 'synthetic-control-not-product-observation', localSignal: local.signal, callerSignal: caller.signal, observedOwnReason: reason, beforeRelease: { handler: { status: 'pending' }, outer: { status: 'pending' } }, handler: { status: 'rejected', reason }, outer: { status: 'rejected', reason }, retirement: { origin: 'product-owned-scheduler-retirement', entered: true, threw: true, reason }, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: 0, rejectionsObserved: true };
}

function metadataToy() {
  const definition = () => Object.freeze({ name: 'timeout' });
  const validate = options => { if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('fixture-only options'); };
  return {
    createTimeoutCommand(options) { validate(options); return definition(); },
    createTimeoutCommands(options) { validate(options); return Object.freeze([definition()]); },
    timeoutCommands(options) { validate(options); return { name: 'timeout-commands' }; },
  };
}

export const controls = Object.freeze([
  { id: 'D01', name: 'pending observation then fulfilled124 remains a value', async run() {
    const latch = controlledLatch(); assert.equal(latch.observation.snapshot().status, 'pending');
    latch.resolve({ exitCode: 124 }); const result = await latch.observation.settled;
    assert.equal(result.status, 'fulfilled'); assert.equal(result.value.exitCode, 124);
  } },
  { id: 'D02', name: 'undefined rejection preserved and observed', async run() {
    const latch = controlledLatch(); latch.reject(undefined); const result = await latch.observation.settled;
    assert.equal(result.status, 'rejected'); assert.ok(Object.hasOwn(result, 'reason')); assert.equal(result.reason, undefined);
  } },
  { id: 'D03', name: 'same identity preserved across promise observation', async run() {
    const reason = Object.freeze({ fixture: true }); const result = await observeSettlement(Promise.reject(reason)).settled;
    assert.equal(result.status, 'rejected'); assert.ok(Object.is(result.reason, reason));
  } },
  { id: 'D04', name: 'synthetic PC01 exact collision matches receipt only', run() { assert.equal(assertCallerCollision(syntheticReceipt()).productActivationProvedByThisPredicate, false); } },
  { id: 'D05', name: 'PC01 rejects raw handler124 despite outer rejection', run() {
    const receipt = syntheticReceipt(); receipt.handler = { status: 'fulfilled', value: { exitCode: 124 } };
    assert.throws(() => assertCallerCollision(receipt), /HANDLER_RETURNED_STATUS/u);
  } },
  { id: 'D06', name: 'PC01 rejects same-shaped different caller reason', run() {
    const receipt = syntheticReceipt(), caller = new AbortController(); caller.abort({ ...receipt.observedOwnReason }); receipt.callerSignal = caller.signal;
    assert.throws(() => assertCallerCollision(receipt), /NOT_SAME_SENTINEL/u);
  } },
  { id: 'D07', name: 'PC01 rejects shared caller and local signal', run() {
    const receipt = syntheticReceipt(); receipt.callerSignal = receipt.localSignal;
    assert.throws(() => assertCallerCollision(receipt), /CALLER_IS_NOT_DISTINCT/u);
  } },
  { id: 'D08', name: 'PC01 rejects early handler settlement', run() {
    const receipt = syntheticReceipt(); receipt.beforeRelease.handler = receipt.handler;
    assert.throws(() => assertCallerCollision(receipt), /HANDLER_SETTLED_BEFORE_CLOSURE/u);
  } },
  { id: 'D09', name: 'PC01 rejects fulfilled outer124', run() {
    const receipt = syntheticReceipt(); receipt.outer = { status: 'fulfilled', value: { exitCode: 124 } };
    assert.throws(() => assertCallerCollision(receipt), /OUTER_RETURNED_STATUS/u);
  } },
  { id: 'D10', name: 'PC01 rejects remaining resources', run() {
    const receipt = syntheticReceipt(); receipt.outstandingOwnedResources = 1;
    assert.throws(() => assertCallerCollision(receipt), /OWNED_RESOURCES_REMAIN/u);
  } },
  { id: 'D11', name: 'synthetic direct PC02 matches but not Shell or activation proof', run() {
    const result = assertDirectRetirementCollision(syntheticReceipt()); assert.equal(result.shellAggregationCovered, false); assert.equal(result.productActivationProvedByThisPredicate, false);
  } },
  { id: 'D12', name: 'PC02 no retirement entry is held, never passed', run() {
    const receipt = syntheticReceipt(); receipt.retirement.entered = false;
    assert.throws(() => assertDirectRetirementCollision(receipt), error => error instanceof HoldoutUnactivated && error.code === 'HOLD_UNACTIVATED');
  } },
  { id: 'D13', name: 'PC02 substituted child provenance is held', run() {
    const receipt = syntheticReceipt(); receipt.retirement.origin = 'child-invoker-throw';
    assert.throws(() => assertDirectRetirementCollision(receipt), HoldoutUnactivated);
  } },
  { id: 'D14', name: 'PC02 rejects retirement reason clone', run() {
    const receipt = syntheticReceipt(); receipt.retirement.reason = { ...receipt.observedOwnReason };
    assert.throws(() => assertDirectRetirementCollision(receipt), /RETIREMENT_NOT_SAME_SENTINEL/u);
  } },
  { id: 'D15', name: 'PC02 rejects retirement mapped to124', run() {
    const receipt = syntheticReceipt(); receipt.handler = { status: 'fulfilled', value: { exitCode: 124 } };
    assert.throws(() => assertDirectRetirementCollision(receipt), /RETIREMENT_MAPPED_TO_STATUS/u);
  } },
  { id: 'D16', name: 'PC02 rejects same-shaped handler rejection', run() {
    const receipt = syntheticReceipt(); receipt.handler = { status: 'rejected', reason: { ...receipt.observedOwnReason } };
    assert.throws(() => assertDirectRetirementCollision(receipt), /RETIREMENT_IDENTITY_LOST/u);
  } },
  { id: 'D17', name: 'PC02 rejects unsettled cleanup', run() {
    const receipt = syntheticReceipt(); receipt.retirementSettled = false;
    assert.throws(() => assertDirectRetirementCollision(receipt), /RETIREMENT_NOT_SETTLED/u);
  } },
  { id: 'D18', name: 'PC02 rejects unobserved rejection paths', run() {
    const receipt = syntheticReceipt(); receipt.rejectionsObserved = false;
    assert.throws(() => assertDirectRetirementCollision(receipt), /REJECTIONS_NOT_OBSERVED/u);
  } },
  { id: 'D19', name: 'metadata-only toy passes partial factory probes', run() {
    assert.equal(probeFactorySurface(metadataToy()).typeOrRegistryProof, false);
    assert.equal(probeFactoryContainers(metadataToy()).records.length, 3);
  } },
  { id: 'D20', name: 'factory surface rejects mutable definition', run() {
    const toy = metadataToy(); toy.createTimeoutCommand = () => ({ name: 'timeout' }); assert.throws(() => probeFactorySurface(toy), assert.AssertionError);
  } },
  { id: 'D21', name: 'factory surface rejects reused definition', run() {
    const toy = metadataToy(), reused = Object.freeze({ name: 'timeout' }); toy.createTimeoutCommand = () => reused;
    assert.throws(() => probeFactorySurface(toy), assert.AssertionError);
  } },
  { id: 'D22', name: 'factory surface rejects undeclared runtime export', run() {
    const toy = { ...metadataToy(), TimeoutLimits: {} }; assert.throws(() => probeFactorySurface(toy), assert.AssertionError);
  } },
  { id: 'D23', name: 'factory container probe rejects permissive toy', run() {
    const toy = metadataToy(); toy.createTimeoutCommand = () => Object.freeze({ name: 'timeout' }); assert.throws(() => probeFactoryContainers(toy), assert.AssertionError);
  } },
  { id: 'D24', name: 'factory container probe detects unknown-key enumeration', run() {
    const toy = metadataToy(), original = toy.createTimeoutCommand; toy.createTimeoutCommand = options => { const result = original(options); if (options) Object.keys(options); return result; };
    assert.throws(() => probeFactoryContainers(toy), /OPTIONS_ENUMERATED/u);
  } },
]);
