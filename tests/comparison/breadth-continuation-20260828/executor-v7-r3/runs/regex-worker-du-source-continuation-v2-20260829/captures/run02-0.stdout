import assert from 'node:assert/strict';
import fs from 'node:fs';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { admitFile, exact, validateRetirement } from './admission.mjs';

export function observeWorkers(configuration) {
  const NativeWorker = workers.Worker;
  const rows = [], admissionRefusals = [], outstanding = new Set();
  let closed = false, closing, active = 0, captured = 0, attempts = 0;
  const emit = value => {
    try {
    const bytes = Buffer.from(JSON.stringify({ pid: process.pid, event: 'worker-parent', ...value }) + '\n');
    captured += bytes.length;
    assert.ok(captured <= configuration.captureBytes, 'PARENT_WORKER_CAPTURE_STOP');
    fs.appendFileSync(configuration.parentLog, bytes);
    } catch (error) { admissionRefusals.push('WORKER_RECEIPT_STOP:' + String(error)); throw error; }
  };
  const requested = { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } };
  const effective = { ...requested, execArgv: ['--import', configuration.preload] };
  admitFile(configuration.preload, configuration.files);
  admitFile(configuration.guard, configuration.files);
  class ObservedWorker extends NativeWorker {
    constructor(url, options) {
      try {
      assert.equal(closed, false, 'LATE_WORKER_ACQUISITION_STOP');
      assert.ok(url instanceof URL && url.href === configuration.entry, 'WORKER_URL_DRIFT');
      exact(options, requested, 'WORKER_OPTIONS_DRIFT');
      admitFile(url.href, configuration.files);
      admitFile(configuration.preload, configuration.files);
      admitFile(configuration.guard, configuration.files);
      assert.ok(active < configuration.maxConcurrent && attempts < configuration.maxStarts, 'WORKER_START_BOUND');
      } catch (error) { admissionRefusals.push(String(error)); emit({ action: 'admission-refused', error: String(error) }); throw error; }
      const token = `${configuration.token}:${rows.length + 1}`;
      const row = { token, entry: url.href, requested, effective, exited: false, exitCode: null, terminatePending: 0, terminateErrors: [], emergency: false, productTerminateCalls: 0, errors: [] };
      const prior = workers.getEnvironmentData('priority-worker-observation-v1');
      const refusalState = new SharedArrayBuffer(4);
      Object.defineProperty(row, 'refusalState', { value: new Int32Array(refusalState) });
      workers.setEnvironmentData('priority-worker-observation-v1', { ...configuration, token, requested, effective, refusalState });
      attempts++; emit({ action: 'constructor-attempt', token, entry: url.href, requested, effective });
      try { super(url, effective); }
      catch (error) { admissionRefusals.push('CONSTRUCTOR_ACQUISITION_UNKNOWN_STOP:' + String(error)); emit({ action: 'constructor-error', token, error: String(error) }); throw error; }
      finally { workers.setEnvironmentData('priority-worker-observation-v1', prior); }
      rows.push(row); active++;
      row.threadId = this.threadId;
      row.resourceLimits = this.resourceLimits;
      let exited;
      row.reaped = new Promise(resolve => { exited = resolve; });
      Object.defineProperty(row, 'worker', { value: this });
      emit({ action: 'start', token, threadId: row.threadId, entry: row.entry, requested, effective, resourceLimits: row.resourceLimits });
      this.on('online', () => { row.online = true; emit({ action: 'online', token, threadId: row.threadId }); });
      this.on('error', error => { row.errors.push(String(error)); emit({ action: 'error', token, error: String(error) }); });
      this.once('exit', code => { active--; row.exited = true; row.exitCode = code; row.childAdmissionRefused = Atomics.load(row.refusalState, 0) !== 0; emit({ action: 'exit', token, code, childAdmissionRefused: row.childAdmissionRefused }); exited(); });
      this.terminate = () => terminate(row, 'product');
    }
  }
  function terminate(row, owner) {
    row.terminatePending++;
    if (owner === 'product') row.productTerminateCalls++; else row.emergency = true;
    emit({ action: 'terminate-call', token: row.token, owner });
    let promise;
    try { promise = Promise.resolve(NativeWorker.prototype.terminate.call(row.worker)); }
    catch (error) { promise = Promise.reject(error); }
    const tracked = promise.then(code => { emit({ action: 'terminate-fulfilled', token: row.token, owner, code }); return code; }, error => {
      row.terminateErrors.push(String(error)); emit({ action: 'terminate-rejected', token: row.token, owner, error: String(error) }); throw error;
    }).finally(() => { row.terminatePending--; outstanding.delete(tracked); });
    outstanding.add(tracked);
    void tracked.catch(() => {});
    return tracked;
  }
  workers.Worker = ObservedWorker;
  syncBuiltinESMExports();
  return {
    rows,
    admissionRefusals,
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const emergency = rows.filter(row => !row.exited && row.productTerminateCalls === 0);
        for (const row of emergency) void terminate(row, 'driver-emergency').catch(() => {});
        let timer;
        try {
          await Promise.race([
            Promise.all([...rows.map(row => row.reaped), ...outstanding]),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WORKER_UNREAPED_STOP')), configuration.cleanupMs); }),
          ]);
        } finally { clearTimeout(timer); }
        validateRetirement(rows);
        return rows.map(({ reaped, ...row }) => row);
      })();
      void closing.catch(() => {});
      return closing;
    },
  };
}
