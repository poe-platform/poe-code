import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { requestObservation, finalizeSteps, accounting } from './driver-lifecycle.mjs';
import { approvedBytes, digest, exactMembership, observerEntries } from './launch-seal.mjs';

const cases = [];
function fixture(sendError = null, throwSend = false, abortOnIntent = false) {
  const child = new EventEmitter(), events = [], timers = new Map(), controller = new AbortController();
  let timerId = 0, sends = 0;
  const clock = { setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(identifier) { timers.delete(identifier); } };
  child.send = (message, callback) => { sends++; if (throwSend) throw new Error('synthetic send throw'); callback(sendError); return true; };
  const emit = event => { events.push(event); if (abortOnIntent && event.event === 'request-dispatch-intent') controller.abort('synthetic publication abort'); };
  const transport = requestObservation({ child, identity: { sequence: 1, requestId: 1 }, recipe: { syntheticHelperOnly: true }, recipeSha256: 'not-a-recipe', baseUrl: 'not-a-server', emit, signal: controller.signal, clock });
  const outcome = transport.promise.then(value => ({ value }), error => ({ error: String(error) }));
  return { child, events, transport, outcome, sends: () => sends, tick() { const callback = timers.values().next().value; assert.ok(callback); callback(); } };
}
async function check(name, operation) { await operation(); cases.push({ name, pass: true }); }

await check('B3 normal settlement, actual event counts and duplicate fencing', async () => {
  const test = fixture(); test.events.push({ event: 'child-launch-attempt' }, { event: 'child-launched' });
  test.child.emit('message', { ready: true }); test.child.emit('message', { id: 1, observation: { synthetic: true } });
  assert.ok((await test.outcome).value); test.transport.beginClosing();
  test.child.emit('message', { ready: true }); test.transport.markClosed(); test.child.emit('message', { id: 1, observation: { late: true } });
  const counts = accounting(test.events);
  assert.equal(test.sends(), 1); assert.equal(counts.launchedChildren, 1); assert.equal(counts.requestSendCalls, 1);
  assert.equal(counts.requestSettlements, 1); assert.equal(counts.responseObservations, 1); assert.equal(counts.lateObservations, 1);
  assert.equal(counts.successfulSendCallbacks, 1); assert.equal(counts.ignoredLateMessages, 2);
});
await check('B3 startup timeout cannot dispatch on late ready', async () => {
  const test = fixture(); test.tick(); test.child.emit('message', { ready: true });
  assert.match((await test.outcome).error, /startup-timeout/); assert.equal(test.sends(), 0);
  assert.equal(accounting(test.events).requestSendCalls, 0); assert.equal(accounting(test.events).timeoutSettlements, 1);
});
await check('B3 request timeout retains late raw response without resettling', async () => {
  const test = fixture(); test.child.emit('message', { ready: true }); test.tick();
  const late = { id: 1, observation: { raw: 'retained' } }; test.child.emit('message', late);
  assert.match((await test.outcome).error, /request-timeout/); assert.equal(test.sends(), 1);
  assert.equal(accounting(test.events).requestSettlements, 1); assert.equal(accounting(test.events).responseObservations, 0);
  assert.deepEqual(test.events.find(event => event.event === 'late-message-ignored').message, late);
});
await check('B3 child error fences late ready', async () => {
  const test = fixture(); test.child.emit('error', new Error('synthetic child error')); test.child.emit('message', { ready: true });
  assert.match((await test.outcome).error, /child-error/); assert.equal(test.sends(), 0);
  assert.equal(accounting(test.events).startupSettlements, 1);
});
await check('B3 explicit closing and publication-abort fences', async () => {
  const closing = fixture(); closing.transport.beginClosing('synthetic cleanup'); closing.child.emit('message', { ready: true });
  assert.match((await closing.outcome).error, /closing/); assert.equal(closing.sends(), 0);
  const aborting = fixture(null, false, true); aborting.child.emit('message', { ready: true });
  assert.match((await aborting.outcome).error, /aborted/); assert.equal(aborting.sends(), 0);
  assert.equal(accounting(aborting.events).requestDispatchIntents, 1); assert.equal(accounting(aborting.events).requestSendCalls, 0);
});
await check('B3 failed callback and synchronous send throw counted separately', async () => {
  for (const throwing of [false, true]) {
    const test = fixture(new Error('synthetic callback error'), throwing); test.child.emit('message', { ready: true }); test.child.emit('message', { ready: true });
    assert.match((await test.outcome).error, /send-error/); assert.equal(test.sends(), 1);
    const counts = accounting(test.events); assert.equal(counts.requestSendCalls, 1); assert.equal(counts.requestSettlements, 1);
    assert.equal(counts.requestSendThrows, Number(throwing)); assert.equal(counts.failedSendCallbacks, Number(!throwing));
  }
});
await check('B1 bound byte hashes and exact two-addition membership', async () => {
  const bytes = Buffer.from('synthetic-approved-bytes'), approvedHash = digest(bytes);
  for (const name of ['download.json', 'actual-node', 'observe-process.mjs']) {
    assert.equal(approvedBytes(name, bytes, approvedHash), bytes);
    assert.throws(() => approvedBytes(name, Buffer.from('changed'), approvedHash), /unapproved consumed input/);
  }
  const names = ['observe-process.mjs', 'observe-load.mjs'];
  const additions = names.map(name => ({ path: `auth-observer/${name}`, source: name, sha256: approvedHash, bytes: bytes.length, mode: 0o444 }));
  assert.deepEqual(observerEntries({ approval: { files: Object.fromEntries(names.map(name => [name, approvedHash])) }, inputs: new Map(names.map(name => [name, bytes])), plan: { closureAdditions: additions } }), additions);
  const membership = ['base-file', ...additions.map(entry => entry.path)]; exactMembership(membership, [...membership].reverse());
  assert.throws(() => exactMembership(membership, [...membership, 'injected.mjs']), /membership/);
  assert.throws(() => exactMembership(membership, membership.slice(1)), /membership/);
});
await check('B2 throwing cleanup and timed-out close still attempt evidence', async () => {
  const events = [], attempted = [];
  const results = await finalizeSteps([
    ['child-cleanup', () => { attempted.push('child-cleanup'); throw new Error('synthetic cleanup failure'); }],
    ['loopback-close', () => { attempted.push('loopback-close'); return new Promise(() => {}); }],
    ['evidence', () => { attempted.push('evidence'); return 'retained'; }],
  ], event => events.push(event), 2);
  assert.deepEqual(attempted, ['child-cleanup', 'loopback-close', 'evidence']);
  assert.deepEqual(results.map(result => result.success), [false, false, true]);
  assert.equal(events.filter(event => event.event === 'finalization-attempt').length, 3);
});
console.log(JSON.stringify({ kind: 'non-product driver helper checks only', cases, pass: cases.length === 8, fakeChildFixtures: 8, realChildren: 0, productImports: 0, productCalls: 0, servers: 0, networkRequests: 0, filesWrittenByChecks: 0, limitation: 'In-memory EventEmitter/manual clocks plus one 2ms helper timeout; not supervisor, engine, package or OS lifecycle execution.' }, null, 2));
