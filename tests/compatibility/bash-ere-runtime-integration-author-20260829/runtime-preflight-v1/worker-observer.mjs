import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ownRecord } from './controller-core.mjs';
const require = createRequire(import.meta.url);
export function observeWorker(spec, emit) {
  const namespace = require('node:worker_threads');
  const NativeWorker = namespace.Worker;
  const rows = [];
  let unsafe;
  function BoundWorker(url, options) {
    if (!(url instanceof URL) || url.protocol !== 'file:' || fileURLToPath(url) !== spec.path) throw new Error('unadmitted Worker URL');
    ownRecord(options, spec.optionKeys);
    ownRecord(options.workerData, ['operation', 'version']);
    ownRecord(options.env, []);
    if (options.workerData.operation !== 'shell-ere' || options.workerData.version !== 1 || !Array.isArray(options.execArgv) || options.execArgv.length || options.stdout !== true || options.stderr !== true) throw new Error('Worker options');
    if (spec.resourceLimits) {
      ownRecord(options.resourceLimits, Object.keys(spec.resourceLimits));
      for (const [key, value] of Object.entries(spec.resourceLimits)) if (options.resourceLimits[key] !== value) throw new Error('Worker resource limit');
    }
    if (rows.length >= spec.maximumStarts) throw new Error('Worker-start cap');
    const stat = fs.lstatSync(spec.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== spec.size || createHash('sha256').update(fs.readFileSync(spec.path)).digest('hex') !== spec.sha256) throw new Error('static Worker identity');
    const row = { admitted: true, exited: false, requests: [], stdoutRetired: false, stderrRetired: false };
    emit({ event: 'worker-admission', ordinal: rows.length });
    const worker = new NativeWorker(url, options);
    rows.push(row);
    try {
      row.threadId = worker.threadId;
      worker.once('exit', code => { row.exited = true; row.exitCode = code; emit({ event: 'worker-exit', threadId: row.threadId, code }); });
      worker.on('error', reason => { row.errorName = reason?.name; });
      for (const channel of ['stdout', 'stderr']) {
        const stream = worker[channel];
        const retired = () => { row[`${channel}Retired`] = true; };
        stream.once('end', retired); stream.once('close', retired);
        if (stream.readableEnded || stream.closed) retired();
      }
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message, ...rest) => {
        if (row.requests.length >= 128) throw new Error('request observation cap');
        const descriptors = Object.getOwnPropertyDescriptors(message);
        for (const key of ['id', 'grantId', 'allowance']) if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) throw new Error('request observation own-data');
        const work = Object.getOwnPropertyDescriptor(message.allowance, 'work');
        if (!work || !Object.hasOwn(work, 'value') || !Number.isSafeInteger(work.value) || work.value < 0) throw new Error('allowance work observation');
        row.requests.push({ id: message.id, grantId: message.grantId, work: work.value });
        return post(message, ...rest);
      };
    } catch (error) { unsafe = error; void worker.terminate().catch(reason => { unsafe = reason; }); throw error; }
    return worker;
  }
  namespace.Worker = BoundWorker;
  syncBuiltinESMExports();
  return {
    rows,
    assertRetired() { if (unsafe || rows.some(row => !row.exited || !row.stdoutRetired || !row.stderrRetired)) throw new Error('unknown/unretired Worker notification'); },
    restore() { namespace.Worker = NativeWorker; syncBuiltinESMExports(); },
    qualification: 'Parent constructor/request/exit/stream observations and static closure only; no nested Worker module-load witness or native-thread-allocation census.'
  };
}
