import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

export const workers = [];
export const lateErrors = [];
export let onAccepted;
export function acceptWith(callback) { onAccepted = callback; }
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    assert.equal(options?.eval, undefined, 'only static worker modules');
    const started = performance.now();
    super(url, options);
    const record = { worker: this, url: String(url), exited: false, terminationCalls: 0, terminationAwaited: false, startupMs: null };
    workers.push(record);
    this.once('exit', code => { record.exited = true; record.exitCode = code; });
    this.once('message', message => { if (message?.ready === true) record.startupMs = performance.now() - started; });
    const post = this.postMessage.bind(this);
    this.postMessage = (message, ...rest) => {
      const result = post(message, ...rest);
      onAccepted?.(message, record);
      return result;
    };
    const terminate = this.terminate.bind(this);
    this.terminate = async () => {
      record.terminationCalls++;
      const result = await terminate();
      record.terminationAwaited = true;
      return result;
    };
    const emit = this.emit.bind(this);
    this.emit = (event, ...args) => {
      if (event === 'error' || event === 'messageerror') lateErrors.push({ event, error: String(args[0]), exited: record.exited });
      return emit(event, ...args);
    };
  }
};
syncBuiltinESMExports();

export function metrics(first = 0) {
  return workers.slice(first).map(({ worker, ...record }) => ({
    ...record,
    listeners: Object.fromEntries(['message', 'messageerror', 'error', 'exit'].map(event => [event, worker.listenerCount(event)])),
  }));
}
export function retired(records) {
  assert.ok(records.every(record => record.exited && record.terminationCalls <= 1 && (!record.terminationCalls || record.terminationAwaited) && Object.values(record.listeners).every(count => count === 0)), 'workers/listeners zero at boundary');
}
export const vector = result => ({ exitCode: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
