import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAdapter } from './adapter.mjs';
const drain = async () => { await new Promise(resolve => setImmediate(resolve)); await Promise.resolve(); };
const results = [];
let resources, adapter;
function stream(iterator = { next() { return Promise.resolve({ done: true }); }, return() { return Promise.resolve({ done: true }); } }) {
  const value = new EventEmitter(); value.closed = false; value.destroyed = false;
  value.destroy = function (...args) { assert.equal(this, value); value.forwarded = args; value.destroyed = true; value.closed = true; value.emit('close'); return value; };
  value[Symbol.asyncIterator] = function (...args) { assert.equal(this, value); value.factoryArgs = args; return iterator; };
  resources.push(value); return value;
}
function boundary(context) { adapter.probe('execute-joined', context); adapter.probe('host-boundary', context); }
const cases = [
  ['I01-throw-forward-cleanup', async () => {
    const context = {}, nextReason = Object.freeze({ next: true }), returnReason = Object.freeze({ return: true });
    const first = stream({ next(...args) { assert.deepEqual(args, [11]); throw nextReason; }, return() { throw new Error('unused'); } });
    adapter.probe('stream-created', context, first);
    const wrapped = first[Symbol.asyncIterator]('factory'); assert.deepEqual(first.factoryArgs, ['factory']);
    assert.throws(() => wrapped.next(11), reason => reason === nextReason);
    const second = stream({ next() { return Promise.resolve({ done: false }); }, return(...args) { assert.deepEqual(args, [12]); throw returnReason; } });
    adapter.probe('stream-created', context, second); const returned = second[Symbol.asyncIterator](); await returned.next(); adapter.probe('reader-yield', second);
    assert.throws(() => returned.return(12), reason => reason === returnReason);
    assert.equal(first.destroy(), first); assert.equal(second.destroy(), second);
    adapter.probe('codec-finalizer-enter', first); adapter.probe('codec-finalizer-enter', second); boundary(context);
    assert.equal(adapter.inspect(context).verdict, 'PASS');
  }],
  ['I02-required-joins', async () => {
    const context = {}, resource = stream(); let resolveWriter;
    const written = new Promise(resolve => { resolveWriter = resolve; });
    adapter.probe('stream-created', context, resource); adapter.probe('codec-acquired', resource); adapter.probe('writer-start', resource, written);
    resource.destroy(); boundary(context);
    const first = adapter.inspect(context); assert.ok(first.holds.includes('private-writer-not-joined')); assert.ok(first.holds.includes('codec-finalizer-pending'));
    resolveWriter(); await written; adapter.probe('writer-joined', resource, written);
    assert.ok(adapter.inspect(context).holds.includes('codec-finalizer-pending'));
    adapter.probe('codec-finalizer-enter', resource); adapter.probe('codec-finalizer-joined', resource);
    assert.equal(adapter.inspect(context).verdict, 'PASS');
  }],
  ['I03-context-cleanup-isolation', async () => {
    const first = {}, second = {}, done = () => {}, pending = () => {};
    adapter.probe('host-registered', first, done); adapter.probe('host-registered', second, pending);
    adapter.probe('cleanup-fulfilled', done); boundary(first); boundary(second);
    assert.equal(adapter.inspect(first).verdict, 'PASS');
    assert.ok(adapter.inspect(second).holds.includes('registered-cleanup-pending'));
    adapter.probe('cleanup-fulfilled', pending); assert.equal(adapter.inspect(second).verdict, 'PASS');
  }],
  ['I04-overflow-still-forwards', async () => {
    adapter = createAdapter({ capacity: 4, identities: 16, streamLimit: 2 });
    const context = {}, resource = stream(); adapter.probe('stream-created', context, resource);
    for (let index = 0; index < 8; index++) adapter.probe('synthetic-overflow', context);
    assert.equal(resource.destroy(), resource); assert.ok(resource.closed && resource.destroyed);
    assert.equal(adapter.verify(), false); assert.equal(adapter.restore().restored, true);
  }],
];
for (const [id, body] of cases) {
  resources = []; adapter = createAdapter(); let error, cleanupError;
  try { await body(); } catch (reason) { error = String(reason?.stack ?? reason); }
  finally {
    try { for (const resource of resources) if (!resource.destroyed) resource.destroy(); await drain(); assert.ok(resources.every(resource => resource.closed && resource.destroyed)); assert.equal(adapter.restore().restored, true); }
    catch (reason) { cleanupError = String(reason?.stack ?? reason); }
  }
  const row = { kind: 'case', id, passed: error === undefined && cleanupError === undefined, error, cleanupError, safety: cleanupError !== undefined, syntheticStreams: resources.length };
  results.push(row); console.log(JSON.stringify(row)); if (cleanupError !== undefined) break;
}
console.log(JSON.stringify({ kind: 'summary', executed: results.length, passed: results.filter(row => row.passed).length, stopped: results.some(row => row.safety), candidateImports: 0, realStreams: 0 }));
process.exitCode = results.length === 4 && results.every(row => row.passed) ? 0 : 1;
