import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAdapter, bindProbe } from './adapter.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(readFileSync(new URL('./PRESEAL.json', import.meta.url)));
const controls = JSON.parse(readFileSync(new URL('./CONTROLS.json', import.meta.url)));
const emit = value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
const drain = async () => {
  for (let turn = 0; turn < 2; turn++) {
    await new Promise(resolve => process.nextTick(resolve));
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }
};
let active;
const adapter = options => { const value = createAdapter(options); active.adapters.push(value); return value; };
function stream() {
  const value = new EventEmitter();
  value.closed = false; value.destroyed = false; value.readableEnded = false; value.bytesWritten = 0;
  value.destroy = function (reason) {
    assert.equal(this, value);
    if (!value.destroyed) {
      value.destroyed = true; value.closed = true;
      setImmediate(() => { if (reason !== undefined) value.emit('error', reason); value.emit('close'); });
    }
    return value;
  };
  value.write = function (...args) { value.lastWrite = { receiver: this, args }; return false; };
  value.end = function (...args) { value.lastEnd = { receiver: this, args }; return this; };
  const nextResult = Promise.resolve({ done: false, value: Buffer.from('constant-owned-data') });
  const returnResult = Promise.resolve({ done: true, value: undefined });
  const rawIterator = {
    next(...args) { assert.equal(this, rawIterator); value.nextArgs = args; return nextResult; },
    return(...args) {
      assert.equal(this, rawIterator); value.returnArgs = args;
      if (value.returnReason) value.destroy(value.returnReason);
      return returnResult;
    },
  };
  value[Symbol.asyncIterator] = function (...args) { assert.equal(this, value); value.factoryArgs = args; return rawIterator; };
  value.test = { nextResult, returnResult, rawIterator, originalDestroy: Object.getOwnPropertyDescriptor(value, 'destroy'),
    originalFactory: Object.getOwnPropertyDescriptor(value, Symbol.asyncIterator) };
  active.streams.push(value);
  return value;
}
const boundary = (observer, context) => { observer.probe('execute-joined', context); observer.probe('host-boundary', context); };
const finishCodec = (observer, context, resource, written) => {
  observer.probe('codec-acquired', resource);
  if (written) observer.probe('writer-joined', resource, written);
  observer.probe('codec-finalizer-enter', resource);
  observer.probe('codec-finalizer-joined', resource);
  boundary(observer, context);
};
const sample = (observer, context, expected, reason) => {
  const value = observer.inspect(context);
  active.snapshots.push(value);
  assert.equal(value.verdict, expected);
  if (reason) assert.ok(value.holds.includes(reason), JSON.stringify(value.holds));
  return value;
};
const bodies = {
  async T01() {
    const observer = adapter(), context = {}, resource = stream();
    observer.probe('stream-created', context, resource);
    const chunk = Buffer.from('small'), callback = () => {};
    assert.equal(resource.write(chunk, 'utf8', callback), false);
    assert.equal(resource.lastWrite.receiver, resource); assert.equal(resource.lastWrite.args[0], chunk); assert.equal(resource.lastWrite.args[2], callback);
    assert.equal(resource.end(chunk, callback), resource); assert.equal(resource.lastEnd.args[1], callback);
    const listener = () => {};
    assert.equal(resource.on('custom', listener), resource); assert.equal(resource.once('custom-once', listener), resource);
    assert.equal(resource.removeListener('custom', listener), resource); assert.equal(resource.listenerCount('custom'), 0);
    const iterator = resource[Symbol.asyncIterator]('factory-arg');
    assert.deepEqual(resource.factoryArgs, ['factory-arg']); assert.equal(iterator.next(7), resource.test.nextResult);
    const value = await resource.test.nextResult; assert.equal(value.value.toString(), 'constant-owned-data');
    observer.probe('reader-yield', resource);
    assert.equal(iterator.return(9), resource.test.returnResult); assert.deepEqual(resource.returnArgs, [9]);
    await resource.test.returnResult;
    finishCodec(observer, context, resource); resource.destroy(); await drain(); sample(observer, context, 'PASS');
  },
  async T02() {
    const observer = adapter(), context = {}, resource = stream(); let release;
    const written = new Promise(resolve => { release = resolve; });
    observer.probe('stream-created', context, resource); observer.probe('writer-start', resource, written);
    try {
      resource.destroy(); await drain(); finishCodec(observer, context, resource);
      sample(observer, context, 'HOLD', 'private-writer-not-joined');
      release(); await written; observer.probe('writer-joined', resource, written); sample(observer, context, 'PASS');
    } finally { release(); await written; }
  },
  async T03() {
    const observer = adapter(), context = {}, callback = () => {};
    boundary(observer, context); sample(observer, context, 'PASS');
    observer.probe('output-open', context, callback); observer.probe('hook-absent', context, callback);
    sample(observer, context, 'HOLD', 'output-cleanup-pending');
    observer.probe('output-close-joined', callback); observer.probe('internal-cleanup-fulfilled', context);
    const result = sample(observer, context, 'PASS');
    assert.equal(result.streams, 0); assert.ok(!result.events.some(row => row.event === 'host-registered'));
  },
  async T04() {
    const observer = adapter(), context = {}; let reject;
    const pending = new Promise((resolve, failure) => { reject = failure; });
    const callback = () => pending;
    observer.probe('output-open', context, callback); observer.probe('hook-present', context, callback);
    observer.probe('host-registered', context, callback); observer.probe('cleanup-start', callback);
    assert.equal(callback(), pending); assert.equal(callback(), pending);
    boundary(observer, context); sample(observer, context, 'HOLD', 'registered-cleanup-pending');
    reject(undefined);
    let hasFailure = false, reason;
    try { await pending; } catch (error) { hasFailure = true; reason = error; observer.probe('cleanup-rejected', callback, error); }
    assert.equal(hasFailure, true); assert.equal(reason, undefined);
    observer.probe('internal-cleanup-rejected', context, reason); sample(observer, context, 'HOLD', 'cleanup-rejected');
  },
  async T05() {
    const observer = adapter(), shell = {}, context = {}, scope = {}, callback = () => {};
    const target = {}, binding = bindProbe(observer, target);
    try { assert.equal(binding.verify(), true); assert.equal(target.__gitAdapterV9, observer.probe); }
    finally { binding.restore(); }
    assert.equal(Object.hasOwn(target, '__gitAdapterV9'), false);
    observer.probe('shell-exec-start', shell); observer.probe('shell-route', context, scope);
    observer.probe('output-open', context, callback); observer.probe('hook-present', context, callback);
    observer.probe('execute-joined', context); observer.probe('shell-exec-joined', shell);
    sample(observer, context, 'HOLD', 'hook-not-forwarded');
    observer.probe('scope-registered', scope, callback); observer.probe('cleanup-start', callback);
    await callback(); observer.probe('cleanup-fulfilled', callback);
    observer.probe('output-close-joined', callback); observer.probe('internal-cleanup-fulfilled', context);
    observer.probe('shell-dispose-joined', shell); sample(observer, context, 'PASS');
  },
  async T06() {
    const observer = adapter(), context = {}, resource = stream();
    resource.returnReason = Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
    observer.probe('stream-created', context, resource);
    const iterator = resource[Symbol.asyncIterator](); await iterator.next(); observer.probe('reader-yield', resource);
    const returned = iterator.return(); assert.equal(returned, resource.test.returnResult); await returned;
    finishCodec(observer, context, resource);
    sample(observer, context, 'HOLD', 'notification-pending');
    await drain(); const positive = sample(observer, context, 'PASS');
    const cause = positive.events.find(row => row.event === 'cause-before-forward');
    const delivered = positive.events.find(row => row.event === 'owned-error');
    assert.ok(cause.sequence < delivered.sequence); assert.equal(cause.value, delivered.value);
    resource.emit('error', Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
    sample(observer, context, 'HOLD', 'unowned-error');
  },
  async T07() {
    const observer = adapter({ capacity: 6 }), context = {}, resource = stream();
    observer.probe('stream-created', context, resource);
    for (let index = 0; index < 12; index++) observer.probe('bounded-overflow', context, index);
    resource.destroy(); await drain(); boundary(observer, context); sample(observer, context, 'HOLD', 'trace-overflow');
    const second = adapter(), nextContext = {}, nextStream = stream();
    second.probe('stream-created', nextContext, nextStream);
    Object.defineProperty(nextStream, 'destroy', { configurable: true, writable: true, value: nextStream.test.originalDestroy.value });
    nextStream.destroy(); await drain(); finishCodec(second, nextContext, nextStream); sample(second, nextContext, 'HOLD', 'integrity');
  },
  async T08() {
    const observer = adapter(), firstContext = {}, secondContext = {}, firstCallback = () => {}, secondCallback = () => {};
    for (const [context, callback] of [[firstContext, firstCallback], [secondContext, secondCallback]]) {
      observer.probe('host-registered', context, callback); boundary(observer, context);
    }
    observer.probe('cleanup-fulfilled', firstCallback); sample(observer, firstContext, 'PASS');
    sample(observer, secondContext, 'HOLD', 'registered-cleanup-pending');
    observer.probe('cleanup-fulfilled', secondCallback); sample(observer, secondContext, 'PASS');
  },
  async T09() {
    const observer = adapter(), context = {}, resource = stream(), primary = new Error('invalid synthetic framing');
    observer.probe('stream-created', context, resource);
    resource.emit('error', primary); observer.probe('codec-primary-mapped', resource, primary);
    resource.destroy(); await drain(); finishCodec(observer, context, resource); sample(observer, context, 'PASS');
    resource.emit('error', primary); sample(observer, context, 'HOLD', 'unowned-error');
  },
  async T10() {
    const observer = adapter(), context = {}, resource = stream(), written = Promise.resolve();
    observer.probe('stream-created', context, resource); observer.probe('writer-start', resource, written);
    const listeners = ['acquire-close-hook', 'writer-close-hook', 'finalizer-close-hook'].map(role => {
      const listener = () => observer.probe(role + '-notification', resource);
      observer.probe(role, resource, listener); resource.once('close', listener); return listener;
    });
    resource.removeListener('close', listeners[1]);
    resource.write(Buffer.from('data'), () => { throw new Error('not invoked in this control'); });
    resource.destroy(); await drain(); await written; finishCodec(observer, context, resource, written);
    const result = sample(observer, context, 'PASS');
    assert.equal(result.events.filter(row => row.event.endsWith('-hook-notification')).length, 2);
    assert.equal(result.events.filter(row => row.event === 'raw-write-callback').length, 0);
  },
  async D01() {
    const source = JSON.parse(readFileSync(new URL('./SOURCE-TRANSFORMS.json', import.meta.url)));
    for (const item of source.sources) {
      const original = Buffer.from(item.sourceBase64, 'base64'); assert.equal(hash(original), item.sha256);
      if (!item.transformedBase64) continue;
      let reconstructed = original.toString();
      for (const change of item.changes) { assert.equal(reconstructed.split(change.before).length, 2); reconstructed = reconstructed.replace(change.before, change.after); }
      reconstructed = item.prefix + reconstructed;
      assert.equal(hash(reconstructed), item.transformedSha256);
      assert.equal(reconstructed, Buffer.from(item.transformedBase64, 'base64').toString());
      let reverse = reconstructed.slice(item.prefix.length);
      for (const change of [...item.changes].reverse()) reverse = reverse.replace(change.after, change.before);
      assert.equal(reverse, original.toString());
      for (const pattern of [/\bawait\b/g, /\.then\s*\(/g, /\.catch\s*\(/g]) assert.equal((reconstructed.match(pattern) ?? []).length, (original.toString().match(pattern) ?? []).length);
    }
    const codec = source.sources.find(item => item.path === 'src/commands/git/codec.ts');
    assert.equal(codec.sha256, '442bd6956340565599afcc1e0762eb7a8d8e001fe8880e9ec8185b1e200bd868');
    const writer = Buffer.from(codec.sourceBase64, 'base64').subarray(1259, 2252);
    assert.equal(hash(writer), '9b54d9f0b5cc73cf776b45b8c57fbc27a7f1acd8ca165306836a1b4760ed1fd6');
    active.data = source.sources.map(item => ({ path: item.path, sha256: item.sha256, transformedSha256: item.transformedSha256, executed: false }));
  },
  async D02() {
    for (const file of seal.files) assert.equal(hash(readFileSync(new URL(file.path, import.meta.url))), file.sha256);
    const adapterText = readFileSync(new URL('./adapter.mjs', import.meta.url), 'utf8');
    assert.equal((adapterText.match(/\bimport\b/g) ?? []).length, 0);
    assert.equal((adapterText.match(/\bawait\b|\.then\s*\(/g) ?? []).length, 1);
    active.data = { candidateExecuted: false, oldQualificationRerun: false, assertionBytesReverseBound: true };
  },
};

await emit({ kind: 'birth', pid: process.pid, ppid: process.ppid, execPath: process.execPath, version: process.version });
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
const results = [];
let stopped = false;
for (const control of controls) {
  active = { adapters: [], streams: [], snapshots: [] };
  let failure, cleanupFailure, timer, hasFailure = false, hasCleanupFailure = false;
  const started = process.hrtime.bigint();
  try {
    await Promise.race([bodies[control.id](), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('control deadline')), 3000); })]);
  } catch (error) { hasFailure = true; failure = error; }
  finally {
    clearTimeout(timer);
    try {
      for (const resource of active.streams) if (!resource.destroyed) resource.destroy();
      await drain();
      assert.ok(active.streams.every(resource => resource.closed && resource.destroyed));
    } catch (error) { hasCleanupFailure = true; cleanupFailure = error; }
    active.restoration = active.adapters.map(value => value.restore());
    for (const resource of active.streams) {
      try {
        assert.deepEqual(Object.getOwnPropertyDescriptor(resource, 'destroy'), resource.test.originalDestroy);
        assert.deepEqual(Object.getOwnPropertyDescriptor(resource, Symbol.asyncIterator), resource.test.originalFactory);
      } catch (error) { hasCleanupFailure = true; cleanupFailure = error; }
    }
  }
  const row = { kind: 'case', id: control.id, role: control.role, passed: !hasFailure && !hasCleanupFailure, hasFailure, hasCleanupFailure,
    safety: hasCleanupFailure || failure?.message === 'control deadline' || hasFailure && control.role === 'data', error: failure?.stack, cleanupError: cleanupFailure?.stack,
    streams: active.streams.length, snapshots: active.snapshots, restoration: active.restoration, data: active.data,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 };
  results.push(row); await emit(row);
  if (row.safety) { stopped = true; break; }
}
await emit({ kind: 'summary', executed: results.length, passed: results.filter(row => row.passed).length,
  failed: results.filter(row => !row.passed).length, stopped, unrun: controls.slice(results.length).map(row => row.id),
  syntheticStreams: results.reduce((total, row) => total + row.streams, 0), actualZlibStreams: 0 });
process.exitCode = !stopped && results.length === controls.length && results.every(row => row.passed) ? 0 : 1;
