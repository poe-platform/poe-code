import workers from 'node:worker_threads';
import { ownedWriter } from './owned-writer.mjs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { admit, bytes, canonicalURL, createPrivate, hash, options, own, reason, requireValue, stickyKey, witness } from './common.mjs';
import { profileBinding } from './policy.mjs';

const NativeWorker = workers.Worker;
const nativeTerminate = NativeWorker.prototype.terminate;
const getEnvironmentData = workers.getEnvironmentData;
const setEnvironmentData = workers.setEnvironmentData;
const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;

let slotBusy = false;

export function createObserver(configuration) {
  const fields = own(configuration, ['profile','entry','members','tools','preload','offline','directory','operation','maximumStarts','emit','reserve','control']);
  requireValue(typeof fields.emit === 'function' && typeof fields.reserve === 'function' && Number.isInteger(fields.maximumStarts) && fields.maximumStarts >= 0 && fields.maximumStarts <= 8, 'OBSERVER_CONFIGURATION');
  requireValue(Array.isArray(fields.members) && fields.members.length === 4 && Array.isArray(fields.tools) && fields.tools.length <= 16, 'CLOSURE_COUNT');
  requireValue(fields.control === null || fields.control.role === 'PRESEALED_HARMLESS_CONTROL', 'CONTROL_ROLE');
  requireValue(fields.profile.kind === 'HARMLESS' || fields.control === null, 'NO_PRODUCTION_FAULT_HOOK');
  profileBinding(fields.profile, fields.entry, fields.members, fields.operation, fields.maximumStarts);
  const writer = ownedWriter({root:fields.directory,entries:Array.from({length:8},(_,index)=>[
    {path:path.join(fields.directory,'worker-'+(index+1)+'.jsonl'),kind:'create',mode:0o600,maximum:32768},
    {path:path.join(fields.directory,'worker-'+(index+1)+'.json'),kind:'create',mode:0o600,maximum:32768},
  ]).flat()});
  const records = [], violations = [], cleanup = [];
  let attempts = 0, active = 0, closed = false, closing, primaryPresent = false, primary, acquisitionUnknown = false;
  const fail = (phase, error) => { if (!primaryPresent) { primaryPresent = true; primary = error; } cleanup.push({ phase, reason: reason(error) }); };
  const emit = value => {
    try {
      requireValue(Buffer.byteLength(JSON.stringify(value)) <= 16384, 'PARENT_RECORD_BOUND');
      fields.emit(value);
    } catch (error) { fail('publication', error); }
  };
  function refuse(error) {
    violations.push(reason(error));
    emit({ event: 'constructor-refused', reason: reason(error) });
    throw error;
  }
  function terminate(record, owner) {
    record.terminateCalls++; record.terminatePending++;
    if (owner !== 'product') record.emergency = true;
    emit({ event: 'terminate-call', token: record.token, owner });
    let pending;
    try { pending = Promise.resolve(nativeTerminate.call(record.worker)); }
    catch (error) { pending = Promise.reject(error); }
    const tracked = pending.then(code => { record.terminateResults.push(reason(code)); emit({ event: 'terminate-fulfilled', token: record.token, owner, code }); return code; }, error => {
      record.terminateErrors.push(reason(error)); emit({ event: 'terminate-rejected', token: record.token, reason: reason(error) }); throw error;
    }).finally(() => { record.terminatePending--; record.pending.delete(tracked); });
    record.pending.add(tracked); void tracked.catch(() => {});
    return tracked;
  }
  class ObservedWorker extends NativeWorker {
    constructor(entry, requestedOptions) {
      try {
        requireValue(!closed, 'ACQUISITION_CLOSED');
        requireValue(!slotBusy, 'WITNESS_SLOT_BUSY');
        canonicalURL(entry, fields.entry); options(requestedOptions);
        requireValue(attempts < fields.maximumStarts && active < 1, 'WORKER_CAP');
        for (const member of [...fields.members, ...fields.tools]) admit(member);
      } catch (error) { refuse(error); }
      const token = `${fields.operation}:${attempts + 1}`;
      const flag = new SharedArrayBuffer(4), atomic = witness({ token, flag }, token);
      requireValue(records.every(record => record.atomic.buffer !== flag), 'WITNESS_ISOLATION');
      const log = path.join(fields.directory, `worker-${attempts + 1}.jsonl`);
      const configPath = path.join(fields.directory, `worker-${attempts + 1}.json`);
      fields.reserve(98304);
      createPrivate(log, '', writer);
      const childConfig = { schema: 'NESTED_REGEX_CONFIG_V3', token, entry: fields.entry, members: fields.members, tools: fields.tools, preload: fields.preload, offline: fields.offline, log, fault: fields.control?.childFault ?? null };
      const configBinding = createPrivate(configPath, childConfig, writer);
      const preload = new URL(fields.preload);
      preload.searchParams.set('config', pathToFileURL(configPath).href); preload.searchParams.set('sha256', configBinding.sha256);
      const effective = { execArgv: ['--import', preload.href], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } };
      const record = { token, entry: fields.entry, requested: { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } }, effective, exited: false, exitCode: null, terminateCalls: 0, terminatePending: 0, terminateErrors: [], terminateResults: [], emergency: false, sticky: 0, witnesses: [], expected: fields.members, errors: [], pending: new Set(), atomic, log, worker: null, reaped: null };
      attempts++;
      emit({ event: 'constructor-attempt', token, requested: record.requested, effective, reservedBytes: 98304 });
      let release;
      record.reaped = new Promise(resolve => { release = resolve; });
      const prior = getEnvironmentData(stickyKey);
      slotBusy = true;
      let enteredNative = false;
      try {
        setEnvironmentData(stickyKey, { token, flag });
        fields.control?.beforeNative?.(ObservedWorker);
        if (fields.control?.constructorFailure) throw fields.control.constructorFailure.reason;
        enteredNative = true;
        super(entry, effective);
        record.worker = this; records.push(record); active++;
        this.once('exit', code => { active--; record.exited = true; record.exitCode = code; record.sticky = Atomics.load(atomic, 0); release(); emit({ event: 'exit', token, code, sticky: record.sticky }); });
        record.errorListener = error => { record.errors.push(reason(error)); emit({ event: 'worker-error', token, reason: reason(error) }); };
        this.on('error', record.errorListener);
        this.terminate = () => terminate(record, 'product');
      } catch (error) {
        if (enteredNative) acquisitionUnknown = true;
        violations.push({ type: 'construction-unknown', reason: reason(error) });
        fail('construction', error); throw error;
      } finally {
        try { setEnvironmentData(stickyKey, prior); slotBusy = false; }
        catch (error) { acquisitionUnknown = true; fail('witness-restoration', error); throw error; }
      }
      emit({ event: 'start', token, threadId: this.threadId });
    }
  }
  return {
    Worker: ObservedWorker,
    install() { workers.Worker = ObservedWorker; syncBuiltinESMExports(); },
    fail(phase, error) { fail(phase, error); },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        for (const record of records) if (!record.exited && record.terminateCalls === 0) void terminate(record, 'emergency').catch(() => {});
        let timer;
        try {
          await Promise.race([
            Promise.all(records.map(async record => { await record.reaped; await Promise.allSettled([...record.pending]); })),
            new Promise((_, reject) => { timer = nativeSetTimeout(() => reject(new Error('WORKER_RETIREMENT_UNKNOWN')), 2500); }),
          ]);
        } catch (error) { fail('retirement', error); }
        finally { nativeClearTimeout(timer); }
        for (const record of records) {
          if (record.exited) record.worker.off('error', record.errorListener);
          record.sticky = Atomics.load(record.atomic, 0);
          try {
            const raw = bytes(record.log, 65536), text = raw.toString('utf8');
            requireValue(text === '' || text.endsWith('\n'), 'JOURNAL_TRUNCATED');
            const rows = text === '' ? [] : text.trimEnd().split('\n').map(line => { requireValue(Buffer.byteLength(line) <= 16384, 'JOURNAL_RECORD_BOUND'); const row = JSON.parse(line); requireValue(row.token === record.token && typeof row.event === 'string', 'JOURNAL_SCHEMA'); return row; });
            record.witnesses = rows;
            record.journal = { bytes: raw.length, sha256: hash(raw), path: record.log };
          } catch (error) { fail('journal', error); }
        }
        try { writer.close(); } catch(error) { fail('writer-retirement',error); }
        emit({ event: 'closed', attempts, created: records.length, active });
        return this.receipt();
      })();
      return closing;
    },
    receipt() {
      return { schema: 'BREADTH_REGEX_RECEIPT_V3', attempts, created: records.length, rows: records.map(({ pending, atomic, log, worker, reaped, journal, errorListener, ...row }) => row), violations, primaryPresent, primary: reason(primary), cleanup, writer: writer.receipt(), closed: closed && writer.receipt().closed && !acquisitionUnknown && active === 0 && records.every(record => record.exited && record.terminatePending === 0) };
    },
    journalReferences() { return records.map(record => record.journal ?? { path: record.log, unqualified: true }); },
  };
}
