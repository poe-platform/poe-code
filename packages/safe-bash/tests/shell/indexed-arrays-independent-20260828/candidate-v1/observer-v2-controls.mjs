import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installTerminalObserver, namedBinding, ownData } from './observer-v2.mjs';

const rows = [];
async function check(id, body) { try { await body(); rows.push({ id, pass: true }); } catch (error) { rows.push({ id, pass: false, error: String(error?.stack ?? error) }); } }
function fixture(capture = () => [[7, 'tail']], closeBehavior) {
  const events = [], completion = Promise.resolve();
  class Owner { close(...args) { events.push({ receiver: this, args }); return closeBehavior ? closeBehavior() : completion; } }
  class Monitor { activate(...args) { return args[0]; } }
  const owner = new Owner(), monitor = new Monitor();
  const original = { close: Owner.prototype.close, activate: Monitor.prototype.activate };
  const roles = { monitorPrototype: Monitor.prototype, ownerPrototype: Owner.prototype, ownerFor: () => owner, isRoot: () => true, capture, terminal: value => value.captures };
  return { owner, monitor, completion, events, original, roles };
}
await check('positive-forward-exact-receiver-args-promise', async () => {
  const model = fixture(), observer = installTerminalObserver(model.roles), argument = {};
  assert.equal(model.monitor.activate(argument), argument);
  assert.equal(model.owner.close(argument, 7), model.completion);
  assert.deepEqual(await observer.after(), [[[7, 'tail']]]); await observer.close();
  assert.equal(model.events.length, 1); assert.equal(model.events[0].receiver, model.owner); assert.deepEqual(model.events[0].args, [argument, 7]);
  assert.equal(model.roles.ownerPrototype.close, model.original.close); assert.equal(model.roles.monitorPrototype.activate, model.original.activate);
});
for (const [label, reason] of [['false', false], ['zero', 0], ['undefined', undefined], ['object', { marker: 'observer' }]]) {
  await check(`throwing-capture-${label}-cannot-block-cleanup`, async () => {
    const model = fixture(() => { throw reason; }), observer = installTerminalObserver(model.roles);
    model.monitor.activate(); assert.equal(model.owner.close(), model.completion); assert.equal(model.events.length, 1);
    await assert.rejects(observer.after(), error => Object.is(error, reason)); await assert.rejects(observer.close(), error => Object.is(error, reason));
    assert.equal(model.roles.ownerPrototype.close, model.original.close);
  });
  await check(`original-close-${label}-identity-before-observer`, async () => {
    const model = fixture(() => { throw new Error('secondary observer'); }, () => { throw reason; }), observer = installTerminalObserver(model.roles);
    model.monitor.activate(); assert.throws(() => model.owner.close(), error => Object.is(error, reason)); assert.equal(model.events.length, 1);
    await assert.rejects(observer.close(), error => Object.is(error, reason));
  });
}
await check('rejected-close-promise-identity-and-observation', async () => {
  const reason = {}, completion = Promise.reject(reason), model = fixture(undefined, () => completion);
  const observer = installTerminalObserver(model.roles); model.monitor.activate(); assert.equal(model.owner.close(), completion);
  await assert.rejects(observer.after(), error => error === reason); await assert.rejects(observer.close(), error => error === reason);
});
await check('deferred-close-is-awaited-before-observer-error', async () => {
  let release; const completion = new Promise(resolve => { release = resolve; }); const reason = {};
  const model = fixture(() => { throw reason; }, () => completion), observer = installTerminalObserver(model.roles);
  model.monitor.activate(); assert.equal(model.owner.close(), completion); let settled = false;
  const pending = observer.after().catch(error => { assert.equal(error, reason); settled = true; });
  await Promise.resolve(); assert.equal(settled, false); release(); await pending; await assert.rejects(observer.close(), error => error === reason);
});
await check('named-wrapper-versus-indexed-binding', () => {
  const binding = { values: new Map([[7, { text: { value: 'tail' }, slot: {} }]]) };
  assert.deepEqual(namedBinding({ binding, name: {}, admission: {} }), [[7, 'tail']]); assert.throws(() => namedBinding(binding));
});
await check('wrong-kind-map-rejected-after-forwarding', async () => {
  const model = fixture(() => namedBinding({ binding: { values: [] }, name: {}, admission: {} })), observer = installTerminalObserver(model.roles);
  model.monitor.activate(); assert.equal(model.owner.close(), model.completion); assert.equal(model.events.length, 1);
  await assert.rejects(observer.after(), TypeError); await assert.rejects(observer.close(), TypeError);
});
await check('named-extra-accessor-no-getter-execution', () => {
  let calls = 0; const value = { binding: {}, name: {}, admission: {} };
  Object.defineProperty(value, 'binding', { get() { calls++; return {}; } }); assert.throws(() => namedBinding(value)); assert.equal(calls, 0);
  assert.throws(() => namedBinding({ binding: {}, name: {}, admission: {}, extra: true }));
});
await check('cross-realm-own-data-and-map-accepted', () => {
  const value = vm.runInNewContext('({binding:{values:new Map([[7,{text:{value:"tail"},slot:{}}]])},name:{},admission:{}})');
  assert.deepEqual(namedBinding(value), [[7, 'tail']]);
});
await check('role-accessor-rejected-before-install', () => {
  const model = fixture(); let calls = 0;
  Object.defineProperty(model.roles, 'capture', { get() { calls++; return () => []; } });
  assert.throws(() => installTerminalObserver(model.roles)); assert.equal(calls, 0); assert.equal(model.roles.ownerPrototype.close, model.original.close);
});
await check('role-extra-and-wrong-function-kind-refuse', () => {
  const model = fixture(); assert.throws(() => installTerminalObserver({ ...model.roles, extra: true })); assert.throws(() => installTerminalObserver({ ...model.roles, capture: [] }));
});
await check('prototype-accessor-refuses-without-getter', () => {
  const model = fixture(); let calls = 0;
  Object.defineProperty(model.roles.ownerPrototype, 'close', { configurable: true, get() { calls++; return () => model.completion; } });
  assert.throws(() => installTerminalObserver(model.roles)); assert.equal(calls, 0); assert.equal(model.roles.monitorPrototype.activate, model.original.activate);
});
await check('own-key-enumeration-reason-is-not-coerced', () => {
  const reason = {}; const value = new Proxy({}, { ownKeys() { throw reason; } }); assert.throws(() => ownData(value, []), error => error === reason);
});
console.log(JSON.stringify({ role: 'observer-v2 actual helper DATA/SYNTHETIC controls; no product/native/child execution', total: rows.length, passed: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).length, rows }, null, 2));
if (rows.some(row => !row.pass)) process.exitCode = 1;
