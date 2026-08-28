import assert from 'node:assert/strict';
import { Scope, deferred, sink, source } from '../mocks.mjs';

export async function runLifecycleControl(kind) {
  if (kind === 'transient-backpressure') {
    const gate = deferred(); const output = sink(64, { retain: true, gate });
    const borrowed = new Uint8Array([97, 98]); let settled = false;
    const writing = output.write(borrowed).then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    await assert.rejects(output.write(Buffer.from('overlap')));
    gate.resolve(); await writing; borrowed.fill(88);
    assert.deepEqual(output.finish().data, Buffer.from('ab'));
    return { writeAwaitedBeforeReuse: true, overlappingWriteRejected: true };
  }
  if (kind === 'owned-finalizer-overwrite') {
    const producer = source(Buffer.from('a\nb\n'), { reuse: true, schedule: 'P2' });
    const iterator = producer[Symbol.asyncIterator](); const first = await iterator.next();
    const owned = Buffer.from(first.value); const expected = Buffer.from(owned);
    await iterator.return(); assert.deepEqual(owned, expected); assert.notDeepEqual(first.value, expected);
    return { retainedCopySurvivesOwnedFinalizer: true, borrowedCloseClaim: false };
  }
  const cleanups = []; const first = new Scope(); const sibling = new Scope();
  first.register(callback => cleanups.push(callback)); sibling.register(callback => cleanups.push(callback));
  const gate = deferred(); const failure = new Error('cleanup failure identity'); let siblings = 0;
  await first.acquire(() => ({}), async () => { if (kind === 'failing-plus-gated') throw failure; });
  await sibling.acquire(() => ({}), async () => { siblings++; await gate.promise; });
  if (kind === 'destination-sibling-alive') {
    await first.close();
    assert.equal(sibling.closed, false);
    const alive = await sibling.acquire(() => ({ active: true }), async () => {}); assert.equal(alive.active, true);
    const closed = sibling.close(); gate.resolve(); await closed; assert.equal(siblings, 1);
    return { stdoutClosedOnly: true, siblingAdmissionSucceeded: true, allClosed: true };
  }
  let settled = false;
  const drained = Promise.allSettled(cleanups.map(callback => callback())).then(results => { settled = true; return results; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  gate.resolve(); const results = await drained;
  assert.equal(results[0].status, 'rejected'); assert.equal(results[0].reason, failure); assert.equal(results[1].status, 'fulfilled'); assert.equal(siblings, 1);
  return { allStartedDespiteFailure: true, exactFailureIdentity: true, gateDrainedBeforeSettlement: true };
}

export function assertAuthority(input, observed) {
  assert.equal(observed.signal, input.signal);
  assert.ok(observed.calls.every(call => call.metadataOnly && call.signal === input.signal));
  const authorities = new Map();
  for (const call of observed.calls) authorities.set(call.authority, (authorities.get(call.authority) ?? 0) + 1);
  assert.ok([...authorities.values()].every(count => count <= 1));
  assert.equal(observed.result, input.expected);
  if (input.complete) assert.equal(observed.calls.length, 0);
  if (input.faithful) assert.equal(observed.forwardedScope, input.scope);
  if (input.copyUp) assert.notEqual(observed.forwardedScope, input.scope);
}

export function authorityControl(kind) {
  const scope = {}; const aliasScope = scope; const distinctScope = {}; const controller = new AbortController();
  const input = { scope, signal: controller.signal, complete: ['same', 'distinct'].includes(kind), faithful: kind === 'faithful', copyUp: kind === 'copy-up',
    expected: kind === 'same' ? 'same' : kind === 'distinct' ? 'distinct' : kind === 'conflict' || kind === 'invalid' ? 'EIO' : kind === 'unknown' ? 'ENOTSUP' : 'same' };
  const left = { identityScope: scope, dev: 1, ino: 2 };
  const right = { identityScope: kind === 'distinct' ? distinctScope : aliasScope, dev: 1, ino: 2 };
  const result = input.complete ? left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? 'same' : 'distinct' : input.expected;
  const observed = { signal: controller.signal, result, calls: input.complete ? [] : [{ authority: scope, signal: controller.signal, metadataOnly: true }],
    forwardedScope: input.copyUp ? distinctScope : scope };
  assertAuthority(input, observed);
  assert.throws(() => assertAuthority(input, { ...observed, signal: new AbortController().signal }));
  if (!input.complete) assert.throws(() => assertAuthority(input, { ...observed, calls: [...observed.calls, ...observed.calls] }));
  if (input.faithful) assert.throws(() => assertAuthority(input, { ...observed, forwardedScope: {} }));
  if (input.copyUp) assert.throws(() => assertAuthority(input, { ...observed, forwardedScope: scope }));
  return { kind, objectIdentityNotShape: true, aliasPreserved: true, calls: observed.calls.length };
}
