import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { own, options, witness, boundFile, terminalOutcome } from './guards.mjs';
import { observeArrays } from './array-observer.mjs';
import { repositoryRoot, resolveInventoryPath } from './root-binding.mjs';
const root = fs.realpathSync(path.dirname(process.argv[1]));
if (!root.startsWith('/private/tmp/')) throw new Error('canonical control root');
for (const [descriptor, suffix] of [[1, '.stdout'], [2, '.stderr']]) { const actual = fs.fstatSync(descriptor), declared = fs.lstatSync(root + '/controller' + suffix); assert.ok(actual.isFile() && declared.isFile() && !declared.isSymbolicLink()); assert.equal(actual.ino, declared.ino); assert.equal(actual.dev, declared.dev); }
const phase = JSON.parse(fs.readFileSync(root + '/START.json', 'utf8'));
assert.ok(Number.isSafeInteger(phase.deadlineMs) && Date.now() < phase.deadlineMs);
const sourceBindings = fs.readFileSync(root + '/CUSTOM-SHA256SUMS', 'utf8').trimEnd().split('\n').map(line => { const match = /^([a-f0-9]{64})  (.+)$/.exec(line); assert.ok(match); return { path: resolveInventoryPath(match[2], repositoryRoot, root), sha256: match[1] }; });
for (const row of sourceBindings) { const stat = fs.lstatSync(row.path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 262144); assert.equal(createHash('sha256').update(fs.readFileSync(row.path)).digest('hex'), row.sha256); }
const results = [];
async function control(id, run) { try { await run(); results.push({ id, status: 'PASS' }); } catch (error) { results.push({ id, status: 'FAIL', diagnostic: String(error) }); } }
await control('inventory/explicit-root-from-isolated-cwd', () => { assert.notEqual(process.cwd(), repositoryRoot); assert.equal(resolveInventoryPath('tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v4/pure-controls.mjs', repositoryRoot, root), repositoryRoot + '/tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v4/pure-controls.mjs'); });
await control('inventory/wrong-root-refused', () => assert.throws(() => resolveInventoryPath('tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v4/pure-controls.mjs', '/', root), /root authority/));
await control('inventory/traversal-refused', () => assert.throws(() => resolveInventoryPath('../pure-controls.mjs', repositoryRoot, root), /not declared/));
await control('inventory/undeclared-absolute-refused', () => assert.throws(() => resolveInventoryPath('/private/tmp/unbound.mjs', repositoryRoot, root), /not declared/));
await control('inventory/copied-entry-exact', () => assert.equal(resolveInventoryPath(root + '/pure-controls.mjs', repositoryRoot, root), root + '/pure-controls.mjs'));
await control('own/null-prototype-accepted', () => own(Object.assign(Object.create(null), { first: 1 }), ['first']));
await control('own/inherited-key-rejected', () => assert.throws(() => own(Object.create({ first: 1 }), ['first']), /own-key/));
await control('own/accessor-not-invoked', () => { let called = false; const value = {}; Object.defineProperty(value, 'first', { get() { called = true; return 1; } }); assert.throws(() => own(value, ['first']), /accessor/); assert.equal(called, false); });
await control('own/order-is-authoritative', () => assert.throws(() => own({ second: 2, first: 1 }, ['first', 'second']), /order/));
await control('witness/exact', () => witness({ core70: 4, kind: 'matcher-checkpoint', ordinal: 1 }));
await control('witness/extra-rejected', () => assert.throws(() => witness({ core70: 4, kind: 'matcher-checkpoint', ordinal: 1, extra: true }), /own-key/));
await control('witness/wrong-role-rejected', () => assert.throws(() => witness({ core70: 4, kind: 'ready', ordinal: 1 }), /identity/));
const validOptions = () => ({ workerData: { operation: 'shell-ere', version: 1 }, env: {}, execArgv: [], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
await control('Worker/options-exact-DATA', () => options(validOptions(), { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }));
await control('Worker/extra-argument-refused-DATA', () => { const value = validOptions(); value.execArgv.push('--eval'); assert.throws(() => options(value, value.resourceLimits), /options/); });
await control('Worker/limit-change-refused-DATA', () => { const value = validOptions(); value.resourceLimits.stackSizeMb = 8; assert.throws(() => options(value, { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }), /resources/); });
for (const [index, reason] of [false, 0, '', null, undefined].entries()) await control('terminal/falsy-' + index, () => { const value = terminalOutcome(true, false, reason); assert.equal(value.status, 'FAIL'); assert.strictEqual(value.primary, reason); assert.equal(value.retired, true); });
await control('terminal/unsafe-retirement-not-green', () => { const value = terminalOutcome(true, true, false); assert.equal(value.status, 'FAIL'); assert.equal(value.retired, false); });
const fixture = root + '/binding.txt'; fs.writeFileSync(fixture, 'bound\n', { flag: 'wx', mode: 0o600 });
const binding = { path: fixture, size: 6, mode: 0o600, sha256: createHash('sha256').update('bound\n').digest('hex') };
await control('source/exact', () => assert.equal(boundFile(binding).toString(), 'bound\n'));
await control('source/wrong-hash-refused', () => assert.throws(() => boundFile({ ...binding, sha256: '0'.repeat(64) }), /hash/));
await control('source/wrong-size-refused', () => assert.throws(() => boundFile({ ...binding, size: 5 }), /size/));
await control('source/parent-traversal-refused', () => assert.throws(() => boundFile({ ...binding, path: root + '/../binding.txt' }), /canonical/));
await control('source/missing-file-refused', () => assert.throws(() => boundFile({ ...binding, path: root + '/missing.txt' }), { code: 'ENOENT' }));
class Owner {
  constructor() { this.calls = []; this.completion = Promise.resolve(); this.ledger = { snapshot: () => ({ caps: [100,100,100,100,100,100,100], used: [0,0,0,0,0,0,0], lastIssued: 0 }) }; }
  reserve(charge) { this.calls.push('reserve'); if (Object.hasOwn(charge, 'fail')) throw charge.fail; return charge; }
  hold() { this.calls.push('hold'); return { release() {} }; }
  close() { this.calls.push('close'); return this.completion; }
}
class Binding {
  constructor(owner) { this.owner = owner; }
  retain() { return this; }
  release() { return this.owner.completion; }
}
await control('array/forward-return-and-close-identity', async () => {
  const observe = observeArrays(Owner, Binding), owner = new Owner(), binding = new Binding(owner), charge = { work: 2 };
  try { assert.strictEqual(owner.reserve(charge), charge); assert.strictEqual(binding.retain(), binding); assert.strictEqual(binding.release(), owner.completion); assert.strictEqual(owner.close(), owner.completion); await observe.settle(); assert.deepEqual(owner.calls, ['reserve', 'close']); }
  finally { observe.restore(); }
});
await control('array/original-falsy-rejection-identity', async () => {
  const observe = observeArrays(Owner, Binding), owner = new Owner();
  try { let rejected = false, reason; try { owner.reserve({ fail: false }); } catch (error) { rejected = true; reason = error; } assert.equal(rejected, true); assert.strictEqual(reason, false); await observe.settle(); }
  finally { observe.restore(); }
});
await control('array/throwing-observer-still-forwards-close', async () => {
  const observe = observeArrays(Owner, Binding), owner = new Owner(), failure = Object.freeze({ observation: true });
  owner.ledger.snapshot = () => { throw failure; };
  try { assert.strictEqual(owner.close(), owner.completion); assert.deepEqual(owner.calls, ['close']); let caught; try { await observe.settle(); } catch (error) { caught = error; } assert.strictEqual(caught, failure); }
  finally { observe.restore(); }
});
await control('array/close-rejection-is-original-not-observer', async () => {
  const observe = observeArrays(Owner, Binding), owner = new Owner(); owner.completion = Promise.reject(false); void owner.completion.catch(() => {});
  try { const returned = owner.close(); assert.strictEqual(returned, owner.completion); let caught; try { await returned; } catch (error) { caught = error; } assert.strictEqual(caught, false); await observe.settle(); assert.ok(observe.rows.some(row => row.outcome === 'rejected')); }
  finally { observe.restore(); }
});
fs.writeFileSync(root + '/ADDITIONAL-CONTROLS.json', JSON.stringify({ status: results.every(row => row.status === 'PASS') ? 'PASS' : 'HOLD', results, productImports: 0, Workers: 0, pid: process.pid }, null, 2) + '\n', { flag: 'wx' });
if (results.some(row => row.status === 'FAIL')) throw new Error('PURE control failure; dependent harmless children not started');
await import('./controls.mjs');
for (const row of sourceBindings) assert.equal(createHash('sha256').update(fs.readFileSync(row.path)).digest('hex'), row.sha256);
assert.ok(Date.now() < phase.deadlineMs);
console.log(JSON.stringify({ additionalPure: results.length, status: 'PASS', ownerResults: 'separate RESULT.json', productExecutions: 0, Workers: 0 }));
