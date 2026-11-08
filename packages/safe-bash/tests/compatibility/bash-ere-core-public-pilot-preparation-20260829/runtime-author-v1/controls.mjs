import './prepare.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createObserver } from './observer.mjs';
import { ownChild } from './process-owner.mjs';
import { captureBudget, writer, clock, ledger, describeLedger, record, validateGrant, validateSelection, schedule, judgeCell } from './core.mjs';
import { read, hash, bind, archiveAdmission, verifyPackage } from './data.mjs';

const root = path.resolve('tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1');
const profile = JSON.parse(read(path.join(root, 'PROFILE.json')));
const results = [];
let fakeConstructors = 0;
let fakeNativeStarts = 0;
let fakeCaseCallbacks = 0;
const control = async (id, body) => { try { await body(); results.push({ id, status: 'PASS' }); } catch (reason) { results.push({ id, status: 'FAIL', detail: String(reason) }); } };
class FakeWorker extends EventEmitter {
  constructor(...args) { super(); fakeConstructors++; this.args = args; this.threadId = 7; this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); }
  postMessage() { throw new Error('not permitted'); }
  terminate() { throw new Error('not permitted'); }
}
const nativeDouble = options => {
  const child = new EventEmitter(); child.pid = 123; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = name => { child.signals.push(name); }; child.signals = [];
  const timers = [];
  const descriptors = [];
  const writes = [];
  const io = { open: name => { descriptors.push(name); return descriptors.length; }, close() {}, write: (descriptor, bytes, offset, count) => { writes.push(bytes.subarray(offset, offset + count)); return count; }, spawn: () => { fakeNativeStarts++; queueMicrotask(() => options(child, timers)); return child; }, later: body => { timers.push(body); return body; }, cancel() {} };
  return { child, timers, descriptors, writes, io };
};
const spec = { id: 'double', executable: 'DOUBLE', argv: [], cwd: 'DOUBLE', env: {}, milliseconds: 10, capture: 64, stdout: 'OUT', stderr: 'ERR' };
await control('C01-frozen-archive-and-selection-admission', () => {
  validateSelection(profile.cells);
  const bytes = read(profile.archive.path, 909885);
  assert.equal(archiveAdmission(profile.archive, bytes), bytes);
  const changed = Buffer.from(bytes); changed[12] ^= 1;
  assert.throws(() => archiveAdmission(profile.archive, changed));
  assert.throws(() => archiveAdmission(profile.archive, bytes.subarray(1)));
  assert.throws(() => validateSelection(profile.cells.slice(1)));
});
await control('C02-future-artifact-bindings-and-tamper', () => {
  for (const layout of profile.layouts) verifyPackage(layout.source, layout.shipping);
  for (const cell of profile.cells) {
    const layout = profile.layouts.find(row => row.name === cell.layout);
    const data = { id: cell.id, definition: cell.definition, limits: cell.inheritedLimits, node: profile.node.path, modulePath: path.join(layout.packageRoot, cell.publicEntry), workerPath: path.join(layout.packageRoot, 'dist/commands/regex-execution/ere/transport/worker-entry.js') };
    assert.equal(hash(Buffer.from(JSON.stringify(data) + '\n')), cell.configSha256);
    data.id = 'foreign'; assert.notEqual(hash(Buffer.from(JSON.stringify(data) + '\n')), cell.configSha256);
  }
  assert.throws(() => bind({ ...profile.assets[0], sha256: '0'.repeat(64) }));
});
await control('C03-constructor-identity-options-and-real-event-shape', () => {
  const url = new URL('file:///fixed/worker-entry.js'); const options = Object.freeze({ env: Object.freeze({}), execArgv: Object.freeze([]) });
  const observer = createObserver({ NativeWorker: FakeWorker, expectedUrl: url.href, emit() {} });
  const worker = new observer.Constructor(url, options);
  assert.equal(worker.args[0], url); assert.equal(worker.args[1], options); assert.equal(observer.owned[0].worker, worker);
  assert.equal(worker.on, EventEmitter.prototype.on); assert.equal(worker.postMessage, FakeWorker.prototype.postMessage); assert.equal(worker.terminate, FakeWorker.prototype.terminate);
  worker.emit('exit', 0); worker.stdout.emit('end'); worker.stderr.emit('close'); observer.assertRetired();
  assert.throws(() => new observer.Constructor(url, options));
});
await control('C04-falsy-enrollment-retains-worker-and-enrolls-streams', () => {
  class FaultWorker extends FakeWorker { once(event, listener) { if (event === 'exit') throw false; return super.once(event, listener); } }
  const observer = createObserver({ NativeWorker: FaultWorker, expectedUrl: 'file:///fixed/worker-entry.js', emit() {} });
  const worker = new observer.Constructor(new URL('file:///fixed/worker-entry.js'), {});
  assert.equal(observer.owned[0].worker, worker); assert.equal(observer.failures.state.reason, false);
  assert.equal(worker.stdout.listenerCount('end'), 1); assert.equal(worker.stderr.listenerCount('end'), 1);
  worker.stdout.emit('end'); worker.stderr.emit('end'); assert.throws(() => observer.assertRetired());
});
await control('C05-native-exit-close-and-independent-EOF', async () => {
  const fake = nativeDouble(child => { child.stdout.emit('data', Buffer.from('ok')); child.emit('exit', 0, null); child.emit('close', 0, null); child.stdout.emit('end'); child.stderr.emit('end'); });
  const ownership = [];
  const receipt = await ownChild(spec, fake.io, ownership, captureBudget(128));
  assert.equal(receipt.retired, true); assert.equal(receipt.failure.present, false); assert.equal(ownership[0].child, fake.child); assert.equal(fake.child.signals.length, 0);
});
await control('C06-close-alone-is-UNKNOWN-and-retains-actual-reference', async () => {
  const fake = nativeDouble((child, timers) => { child.emit('close', 0, null); timers[2](); });
  const ownership = [];
  const receipt = await ownChild(spec, fake.io, ownership, captureBudget(128));
  assert.equal(receipt.retired, false); assert.equal(receipt.cutoff, true); assert.equal(ownership[0].child, fake.child); assert.equal(receipt.exit, false);
});
await control('C07-partial-capture-undefined-primary-false-cleanup', async () => {
  let opens = 0; let spawns = 0;
  const io = { open() { if (++opens === 2) throw undefined; return 1; }, close() { throw false; }, spawn() { spawns++; } };
  const receipt = await ownChild(spec, io, [], captureBudget(128));
  assert.equal(spawns, 0); assert.equal(receipt.failure.present, true);
  assert.deepEqual(receipt.failure.primary.reason, { type: 'undefined' }); assert.deepEqual(receipt.failure.secondary[0].reason, { type: 'boolean', value: false });
});
await control('C08-capture-prewrite-and-zero-write-no-refund', () => {
  let calls = 0; const aggregate = captureBudget(4);
  const output = writer({ maximum: 2, aggregate, write() { calls++; return 0; } });
  assert.throws(() => output.bytes(Buffer.from('123'))); assert.equal(calls, 0);
  const other = writer({ maximum: 4, aggregate, write() { calls++; return 0; } });
  assert.throws(() => other.bytes(Buffer.from('1234'))); assert.equal(aggregate.snapshot().admitted, 4);
});
await control('C09-typed-clock-grant-and-crossrealm-own-data', () => {
  let current = 1007000; const timer = clock(0, () => current);
  assert.equal(timer.admit(10000), true); current++; assert.equal(timer.admit(10000), false); current = 0; assert.throws(() => timer.sample());
  const value = vm.runInNewContext('({ present: false, value: 0 })'); record(value, ['present', 'value']);
  let getterCalls = 0; const accessor = { get present() { getterCalls++; return false; }, value: 0 };
  assert.throws(() => record(accessor, ['present', 'value'])); assert.equal(getterCalls, 0);
  const grant = JSON.parse(read(path.join(root, 'GRANT-TEMPLATE.json')));
  assert.throws(() => validateGrant(grant, grant.profileSha256, 0, Date.now()));
});
await control('C10-exact-24-schedule-and-no-next-on-UNKNOWN', async () => {
  const makeHost = unknown => ({ started: 0, now: () => 0, prepare: async () => {}, sample: async () => {}, run: async cell => { fakeCaseCallbacks++; return { id: cell.id, status: unknown ? 'UNKNOWN' : 'PASS', workers: unknown ? 0 : 1 }; }, publish: async () => {}, emergency: async () => {} });
  const complete = await schedule(profile, makeHost(false)); assert.equal(complete.complete, true); assert.equal(complete.workerStarts, 24);
  const partial = await schedule(profile, makeHost(true)); assert.equal(partial.complete, false); assert.equal(partial.outcomes.filter(row => row.status === 'UNRUN').length, 23);
  const failure = describeLedger(ledger().state);
  const cell = profile.cells[0];
  const receipt = { retired: true, failure, code: 0, signal: null, pid: 7 };
  const rows = [{ event: 'startup', pid: 7 }, { event: 'final', id: cell.id, result: { exitCode: cell.definition.expected.exitCode, stdout: cell.definition.expected.stdout, stderr: '' }, workers: [], failure }];
  assert.equal(judgeCell(cell, receipt, rows).status, 'PASS');
  rows[1].failure = { ...failure, present: 0 }; assert.throws(() => judgeCell(cell, receipt, rows));
});
const receipt = { at: new Date().toISOString(), profileSha256: hash(read(path.join(root, 'PROFILE.json'))), controls: results, count: results.length, passed: results.filter(row => row.status === 'PASS').length, fakeConstructors, fakeNativeStarts, fakeCaseCallbacks, actualWorkers: 0, actualChildren: 0, productImports: 0, archiveInflations: 0, historicalPreparationFailureRetained: true, evaluatedModules: ['prepare.mjs', 'core.mjs', 'data.mjs', 'observer.mjs', 'process-owner.mjs'], unevaluatedRuntimeEntries: ['coordinator.mjs', 'cell.mjs'] };
fs.writeFileSync(path.join(root, 'PURE-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = receipt.passed === 10 ? 0 : 1;
