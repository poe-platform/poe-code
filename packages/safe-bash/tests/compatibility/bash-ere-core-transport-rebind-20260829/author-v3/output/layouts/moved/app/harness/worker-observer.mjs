import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundFile, own, options as validateOptions, witness, deferred } from './guards.mjs';
const require = createRequire(import.meta.url);
export function observeWorker(spec, emit) {
  const namespace = require('node:worker_threads'), NativeWorker = namespace.Worker;
  const rows = [], controls = [];
  let failure, failed = false, selected = 'stock', gate, waiting, replyWait;
  const remember = reason => { if (!failed) { failed = true; failure = reason; } };
  function BoundWorker(url, options) {
    if (!(url instanceof URL) || fileURLToPath(url) !== spec.path) throw new Error('production Worker URL binding');
    validateOptions(options, spec.resourceLimits);
    boundFile({ path: spec.path, size: spec.size, mode: spec.mode, sha256: spec.sha256 });
    for (const member of spec.closure) boundFile(member);
    const role = spec.roles.find(entry => entry.name === selected);
    if (!role) throw new Error('unadmitted Worker role');
    let entry = url;
    if (role.file) { boundFile(role.file); entry = pathToFileURL(role.file.path); }
    if (rows.length >= spec.maximumStarts) throw new Error('Worker-start cap');
    const worker = new NativeWorker(entry, options);
    const row = { role: selected, threadId: worker.threadId, exited: false, stdoutRetired: false, stderrRetired: false, requests: [], replies: [] };
    rows.push(row);
    const on = worker.on.bind(worker), post = worker.postMessage.bind(worker);
    worker.once('exit', code => { row.exited = true; row.exitCode = code; });
    worker.on('error', reason => { row.errorName = reason?.name; });
    for (const channel of ['stdout', 'stderr']) {
      const stream = worker[channel];
      const retired = () => { row[channel + 'Retired'] = true; };
      stream.once('end', retired); stream.once('close', retired);
      if (stream.closed || stream.readableEnded) retired();
    }
    on('message', message => {
      try {
        if (message && Object.getOwnPropertyDescriptor(message, 'core70')) {
          if (row.role !== 'checkpoint' || !waiting) throw new Error('unexpected witness');
          witness(message); waiting.resolve(message); waiting = undefined;
        } else if (message?.kind === 'result' || message?.kind === 'failure') {
          if (row.replies.length >= 128) throw new Error('reply observation cap');
          row.replies.push({ kind: message.kind, category: message.category, resource: message.resource, work: message.usage?.work });
          if (replyWait && rows.reduce((total, item) => total + item.replies.length, 0) >= replyWait.count) { replyWait.wait.resolve(); replyWait = undefined; }
        }
      } catch (reason) { remember(reason); void worker.terminate().catch(remember); }
    });
    worker.on = function(event, listener) {
      if (event !== 'message') return on(event, listener);
      return on(event, function(message, ...rest) {
        if (message && Object.getOwnPropertyDescriptor(message, 'core70')) return;
        return Reflect.apply(listener, this, [message, ...rest]);
      });
    };
    worker.postMessage = (message, ...rest) => {
      if (row.requests.length >= 128) throw new Error('request observation cap');
      const descriptors = Object.getOwnPropertyDescriptors(message);
      for (const key of ['id', 'grantId', 'allowance']) if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) throw new Error('request own-data');
      const work = Object.getOwnPropertyDescriptor(message.allowance, 'work');
      if (!work || !Object.hasOwn(work, 'value') || !Number.isSafeInteger(work.value)) throw new Error('allowance own-data');
      row.requests.push({ id: message.id, grantId: message.grantId, work: work.value });
      if (gate) {
        const current = gate; gate = undefined;
        current.forward = () => { if (current.used) throw new Error('double forward'); current.used = true; post(message, ...rest); };
        current.entered.resolve(); return;
      }
      return post(message, ...rest);
    };
    try { emit({ event: 'worker-admission', role: row.role, threadId: row.threadId }); }
    catch (reason) { remember(reason); void worker.terminate().catch(remember); throw reason; }
    return worker;
  }
  namespace.Worker = BoundWorker; syncBuiltinESMExports();
  return {
    rows,
    select(name) { if (!spec.roles.some(role => role.name === name)) throw new Error('unadmitted role'); selected = name; },
    expectWitness() { if (waiting) throw new Error('overlapping witness'); waiting = deferred(); controls.push(waiting); return waiting.promise; },
    expectReplies(additional) { if (replyWait || additional !== 2) throw new Error('fixed reply wait'); const wait = deferred(); replyWait = { count: rows.reduce((total, row) => total + row.replies.length, 0) + additional, wait }; controls.push(wait); return wait.promise; },
    requestGate() {
      if (gate) throw new Error('overlapping gate');
      const current = { entered: deferred(), used: false, forward: undefined };
      gate = current; controls.push(current.entered);
      return { entered: current.entered.promise, forward() { if (!current.forward) throw new Error('gate not entered'); current.forward(); }, cancel() { current.used = true; current.forward = undefined; if (gate === current) gate = undefined; current.entered.cancel(); } };
    },
    assertRetired() { if (failed) throw failure; if (rows.some(row => !row.exited || !row.stdoutRetired || !row.stderrRetired)) throw new Error('unknown Worker retirement'); },
    restore() { for (const control of controls) control.cancel(); namespace.Worker = NativeWorker; syncBuiltinESMExports(); },
    qualification: 'TEST-ONLY parent observer; checkpoint/fault roles are instrumented, never stock Worker evidence. Static closure is not a nested load witness.'
  };
}
