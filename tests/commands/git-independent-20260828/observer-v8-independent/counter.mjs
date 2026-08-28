import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Observer, comparePredicates, inspectState, notificationHorizon } from './observer.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let notifications = 0;
class Facade extends EventEmitter {
  destroyed = false; closed = false;
  write(bytes, callback) { callback?.(); return false; }
  end() { return this; }
  destroy(reason) { if (this.destroyed) return this; this.destroyed = this.closed = true; notifications++; queueMicrotask(() => { try { if (reason != null) this.emit('error', reason); this.emit('close'); } finally { notifications--; } }); return this; }
  [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: Buffer.from('x') }), return: async () => ({ done: true }) }; }
}
async function bounded(promise) { let timer; try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('independent owned horizon timeout')), 1000); })]); } finally { clearTimeout(timer); } }
const results = [];
for (const id of ['I01-deferred-return', 'I02-cross-resource-reason', 'I03-falsy-cleanup-promise', 'I04-writer-promise-not-flags', 'I05-naive-iterator-hook']) {
  const observer = new Observer(id), resources = [], pending = [], releases = [];
  let passed = false, detail, failure, cleanupFailure;
  const acquire = () => { const resource = observer.reserve(), stream = new Facade(); observer.attach(resource, stream); resources.push(resource); return resource; };
  try {
    const resource = acquire(), stream = resource.stream;
    if (id === 'I01-deferred-return') {
      const gate = deferred(), reason = new Error('owned synthetic return'); releases.push(gate.resolve);
      stream[Symbol.asyncIterator] = () => ({ next: async () => ({ done: false, value: Buffer.from('x') }), return() { assert.equal(resource.ownedOperationPending, 1); assert.equal(resource.retirements.at(-1).state, 'active'); stream.destroy(reason); return gate.promise; } });
      const iterator = resource.retirement.iterator(); await iterator.next();
      const returning = iterator.return(); pending.push(returning); returning.catch(() => {});
      const settlement = observer.settle(); assert.equal(inspectState(settlement), 'HOLD');
      gate.resolve({ done: true }); await returning; resource.cleanup = 'settled';
      const horizon = await bounded(notificationHorizon(observer));
      assert.equal(comparePredicates(settlement, horizon).proposedTerminal, 'HOLD');
      assert.equal(inspectState(horizon), 'CLEAR'); assert.equal(resource.causes[0].reason, reason);
      assert.ok(resource.causes[0].enrolledSequence < observer.trace.find(row => row.event === 'stream-error').sequence);
      detail = { pendingBeforeReturnSettlement: true, identicalCause: true, refusedEarlierPending: true };
    } else if (id === 'I02-cross-resource-reason') {
      const other = acquire(), reason = new Error('same object, wrong stream');
      resource.retirement.destroyOwned(reason); other.retirement.destroyOwned(undefined);
      resource.cleanup = other.cleanup = 'settled'; await bounded(notificationHorizon(observer));
      const settlement = observer.settle(); assert.equal(inspectState(settlement), 'CLEAR');
      other.stream.emit('error', reason); const horizon = await bounded(notificationHorizon(observer));
      const failure = observer.failures.at(-1); assert.equal(failure.reason, reason); assert.equal(failure.resourceId, other.id); assert.equal(failure.acknowledged, false);
      assert.equal(comparePredicates(settlement, horizon).proposedTerminal, 'HOLD'); detail = { sameReasonOtherResourceRefused: true };
    } else if (id === 'I03-falsy-cleanup-promise') {
      observer.primaryFailure(false); let rejected = false;
      await Promise.reject(undefined).catch(reason => { rejected = true; assert.equal(reason, undefined); resource.cleanup = 'rejected'; observer.failure(reason, 'owned-cleanup-rejection'); });
      resource.retirement.destroyOwned(undefined); await bounded(notificationHorizon(observer));
      assert.equal(rejected, true); assert.equal(observer.hasPrimary, true); assert.equal(observer.primary, false); assert.equal(inspectState(observer.settle()), 'HOLD');
      detail = { actualPromiseRejectedUndefined: true, primaryFalsePreserved: true };
    } else if (id === 'I04-writer-promise-not-flags') {
      const gate = deferred(); releases.push(gate.resolve); const writing = observer.runOperation(resource, 'writer', () => gate.promise); pending.push(writing); writing.catch(() => {});
      resource.retirement.destroyOwned(undefined); resource.cleanup = 'settled'; await bounded(notificationHorizon(observer));
      const settlement = observer.settle(); assert.equal(stream.closed, true); assert.equal(resource.writePending, 0); assert.equal(inspectState(settlement), 'HOLD');
      gate.resolve(); await writing; const horizon = await bounded(notificationHorizon(observer));
      assert.equal(inspectState(horizon), 'CLEAR'); assert.equal(comparePredicates(settlement, horizon).proposedTerminal, 'HOLD');
      detail = { directlyHeldSyntheticPromise: true, notCandidateWriterProof: true, flagsInsufficient: true };
    } else {
      const original = Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator); let calls = 0;
      stream[Symbol.asyncIterator] = () => { calls++; return resource.retirement.iterator(); };
      try { assert.throws(() => stream[Symbol.asyncIterator](), /one owned iterator per stream/u); assert.equal(calls, 2); }
      finally { if (original) Object.defineProperty(stream, Symbol.asyncIterator, original); else delete stream[Symbol.asyncIterator]; }
      resource.retirement.destroyOwned(undefined); resource.cleanup = 'settled'; await bounded(notificationHorizon(observer));
      detail = { naiveReplacementRefused: true, calls, requiresSavedOriginalFactoryOrFacade: true };
    }
    passed = true;
  } catch (reason) { failure = String(reason?.stack ?? reason); }
  finally {
    try {
      for (const release of releases) release({ done: true });
      await Promise.allSettled(pending);
      for (const resource of resources) { if (!resource.stream.destroyed) resource.retirement.destroyOwned(undefined); }
      await bounded(notificationHorizon(observer));
      for (const resource of resources) { observer.restoreHooks(resource); assert.equal(resource.hookReceipt.destroyRestored, true); assert.equal(resource.hookReceipt.callbacksRestored, true); }
      assert.equal(notifications, 0);
    } catch (reason) { cleanupFailure = String(reason?.stack ?? reason); }
  }
  const row = { kind: 'independent', id, passed, detail, failure, cleanupFailure, syntheticResources: resources.length, trace: observer.trace };
  results.push({ id, passed, cleanupFailure }); process.stdout.write(JSON.stringify(row) + '\n');
  if (cleanupFailure) break;
}
process.stdout.write(JSON.stringify({ kind: 'independent-summary', expected: 5, executed: results.length, results, notifications, candidateImports: 0, actualZlibObjects: 0 }) + '\n');
process.exitCode = results.length === 5 && results.every(row => row.passed && !row.cleanupFailure) ? 0 : 1;
