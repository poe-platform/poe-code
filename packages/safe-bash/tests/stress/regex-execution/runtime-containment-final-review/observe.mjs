import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getEventListeners } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';

export const scope = new AsyncLocalStorage();
export const workers = [];
export const boundaries = [];
export const lateErrors = [];
export const admissions = [];
export const signals = new Map();
export const hooks = { accepted: undefined, admission: undefined, held: undefined, holdResponses: false };
const NativeWorker = workerThreads.Worker;
const nativeAdd = AbortSignal.prototype.addEventListener;
AbortSignal.prototype.addEventListener = function (event, listener, options) {
  const result = nativeAdd.call(this, event, listener, options);
  const owner = scope.getStore();
  if (owner && event === 'abort') {
    if (!signals.has(owner)) signals.set(owner, new Set());
    signals.get(owner).add(this);
    if (typeof listener === 'function' && Function.prototype.toString.call(listener).includes('this.queue.indexOf(pending)')) {
      const record = { owner, atMs: performance.now(), callbackSha256: createHash('sha256').update(Function.prototype.toString.call(listener)).digest('hex') };
      admissions.push(record);
      queueMicrotask(() => hooks.admission?.(record));
    }
  }
  return result;
};
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    assert.equal(options?.eval, undefined);
    super(url, options);
    this.record = { worker: this, owner: scope.getStore(), url: String(url), options, exited: false, readyAtMs: null, terminationCalls: 0, terminationAwaited: false, requests: [], responses: [], held: [] };
    workers.push(this.record);
  }
  emit(event, ...args) {
    const record = this.record;
    if (record && event === 'exit') { record.exited = true; record.exitCode = args[0]; }
    if (record && (event === 'error' || event === 'messageerror')) lateErrors.push({ event, error: String(args[0]), owner: record.owner });
    if (record && event === 'message') {
      if (args[0]?.ready === true) record.readyAtMs = performance.now();
      else if (args[0]?.id !== undefined) {
        record.responses.push({ id: args[0].id, atMs: performance.now() });
        const request = record.requests.find(request => request.id === args[0].id);
        if (hooks.holdResponses && request?.rows.length) { record.held.push(args); hooks.held?.(record); return true; }
      }
    }
    return super.emit(event, ...args);
  }
  postMessage(message, ...rest) {
    const result = super.postMessage(message, ...rest);
    const record = this.record;
    record.requests.push({ owner: scope.getStore(), id: message.id, atMs: performance.now(), descriptor: message.descriptor, rows: message.rows.map(row => ({ bytes: Buffer.from(row.bytes).toString('base64'), terminated: row.terminated })) });
    hooks.accepted?.(message, record);
    return result;
  }
  async terminate() {
    this.record.terminationCalls++;
    const result = await super.terminate();
    this.record.terminationAwaited = true;
    return result;
  }
  releaseResponses() {
    for (const args of this.record.held.splice(0)) super.emit('message', ...args);
  }
};
syncBuiltinESMExports();
export const metrics = () => workers.map(({ worker, held, ...record }) => ({ ...record, heldResponses: held.length, listeners: Object.fromEntries(['message', 'messageerror', 'error', 'exit'].map(event => [event, worker.listenerCount(event)])) }));
export const listenerMetrics = owner => [...(signals.get(owner) ?? [])].map(signal => ({ aborted: signal.aborted, listeners: getEventListeners(signal, 'abort').length }));
export const vector = result => ({ exitCode: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
export function retired(records) {
  assert.ok(records.every(record => record.exited && record.heldResponses === 0 && record.terminationCalls <= 1 && (!record.terminationCalls || record.terminationAwaited) && Object.values(record.listeners).every(count => count === 0)), 'owned workers/listeners retired before dispose');
}
export function install(api) {
  const exec = api.Shell.prototype.exec;
  let sequence = 0;
  api.Shell.prototype.exec = function (command, options = {}) {
    const owner = scope.getStore() ?? `benign-${++sequence}`;
    const capture = (value, error, rejected) => {
      boundaries.push({ owner, command, rejected, result: value ? vector(value) : undefined, error: rejected ? String(error) : undefined, exactCallerReason: options.signal?.aborted ? error === options.signal.reason : null, callerListeners: options.signal ? getEventListeners(options.signal, 'abort').length : null, signals: listenerMetrics(owner), workers: metrics() });
    };
    return scope.run(owner, () => exec.call(this, command, options)).then(value => { capture(value, undefined, false); return value; }, error => { capture(undefined, error, true); throw error; });
  };
}
