import workerThreads from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getEventListeners } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = resolve(process.argv[1]);
const format = process.argv[2];
const moduleLocation = format === 'packed'
  ? (await import(pathToFileURL(resolve(dirname(entry), 'runtime-r1-package-resolver.mjs')))).moduleLocation
  : pathToFileURL(resolve(format === 'candidate' ? resolve(dirname(entry), 'snapshots/candidate') : format, 'dist/index.js')).href;
const executions = new AsyncLocalStorage();
const workers = [];
const boundaries = [];
const contexts = new Map();
const shells = new WeakMap();
let nextExecution = 0;
let nextShell = 0;
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class BoundaryWorker extends NativeWorker {
  constructor(url, options) {
    super(url, options);
    workers.push({ worker: this, id: workers.length + 1, originExecution: executions.getStore(), url: String(url), options, exited: false, terminationCalls: 0, terminationAwaited: false });
  }
  emit(event, ...args) {
    const record = workers.find(item => item.worker === this);
    if (record && event === 'exit') { record.exited = true; record.exitCode = args[0]; }
    return super.emit(event, ...args);
  }
  async terminate() {
    const record = workers.find(item => item.worker === this);
    record.terminationCalls++;
    const result = await super.terminate();
    record.terminationAwaited = true;
    return result;
  }
};
syncBuiltinESMExports();
const api = await import(moduleLocation);
const metrics = () => workers.map(({ worker, ...record }) => ({ ...record, listeners: Object.fromEntries(['message', 'messageerror', 'error', 'exit'].map(event => [event, worker.listenerCount(event)])) }));
const describe = value => value instanceof Error
  ? { type: value.constructor.name, name: value.name, message: value.message, code: value.code, limit: value.limit, errors: value instanceof AggregateError ? value.errors.map(describe) : undefined }
  : { type: typeof value, value };
const exec = api.Shell.prototype.exec;
api.Shell.prototype.exec = function (source, options = {}) {
  if (!shells.has(this)) {
    shells.set(this, ++nextShell);
    this.use(async (context, next) => {
      const execution = executions.getStore();
      if (!contexts.has(execution)) contexts.set(execution, []);
      contexts.get(execution).push({ command: context.command, signal: context.signal });
      return next();
    });
  }
  const execution = ++nextExecution;
  const shell = shells.get(this);
  const before = options.signal ? getEventListeners(options.signal, 'abort').length : null;
  const record = (result, error, rejected) => {
    boundaries.push({ kind: 'exec', execution, shell, source, rejected, result: result ? { exitCode: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') } : undefined, error: rejected ? describe(error) : undefined, callerAborted: options.signal?.aborted ?? false, exactCallerReason: options.signal?.aborted ? error === options.signal.reason : null, callerAbortListenersBefore: before, callerAbortListeners: options.signal ? getEventListeners(options.signal, 'abort').length : null, contexts: (contexts.get(execution) ?? []).map(({ command, signal }) => ({ command, aborted: signal.aborted, abortListeners: getEventListeners(signal, 'abort').length })), workers: metrics() });
  };
  return executions.run(execution, () => exec.call(this, source, options)).then(result => { record(result, undefined, false); return result; }, error => { record(undefined, error, true); throw error; });
};
const dispose = api.Shell.prototype.dispose;
api.Shell.prototype.dispose = function () {
  if (!shells.has(this)) shells.set(this, ++nextShell);
  const shell = shells.get(this);
  return dispose.call(this).then(result => { boundaries.push({ kind: 'dispose', shell, rejected: false, workers: metrics() }); return result; }, error => { boundaries.push({ kind: 'dispose', shell, rejected: true, error: describe(error), workers: metrics() }); throw error; });
};
const send = process.send.bind(process);
process.send = (message, ...args) => send(message?.kind === 'result' ? { ...message, boundaryObserver: { moduleLocation, method: 'public promise continuation before harness finally/dispose; no additional worker listeners; transparent middleware records command signal listener counts', boundaries, finalWorkers: metrics() } } : message, ...args);
