import { setTimeout as delay } from 'node:timers/promises';
import { errorRecord, requireThat } from '../executor-v4/safety.mjs';

function absent(identifier) {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
export function createLedger(maximum) {
  const entries = [];
  const handles = new Map();
  const receipts = new Map();
  function remember(entry, receipt) {
    receipts.set(entry.ordinal, receipt);
    Object.assign(entry, { pid: receipt.pid, group: receipt.pid ? -receipt.pid : null, exit: receipt.exit, close: receipt.close, reaped: receipt.reaped, natural: receipt.natural, failures: receipt.failures, signals: receipt.signals });
  }
  return {
    entries,
    enroll(kind) {
      requireThat(entries.length < maximum && !entries.some(entry => ['LAUNCHING', 'UNSAFE_STOP'].includes(entry.state)), 'LAUNCH_LEDGER_BOUND', entries.length);
      const entry = { ordinal: entries.length + 1, kind, state: 'ENROLLED', launchAttempted: false, pid: null, group: null, exit: null, close: null, reaped: false, persisted: false, errors: [] };
      entries.push(entry);
      return entry;
    },
    starting(entry) { entry.launchAttempted = true; entry.state = 'LAUNCHING'; },
    attach(entry, handle, receipt) {
      handles.set(entry.ordinal, handle);
      receipts.set(entry.ordinal, receipt);
      entry.pid = handle.pid ?? null;
      entry.group = handle.pid ? -handle.pid : null;
    },
    complete(entry, receipt) { remember(entry, receipt); entry.state = 'SUPERVISED'; },
    persisted(entry, sha256) { entry.receiptSha = sha256; entry.persisted = true; entry.state = 'PERSISTED'; },
    failed(entry, phase, error) {
      const receipt = receipts.get(entry.ordinal);
      if (receipt) { remember(entry, receipt); entry.emergencyReceipt = receipt; }
      entry.errors.push({ phase, error: errorRecord(error) });
      entry.state = 'UNSAFE_STOP';
    },
    async emergency(entry) {
      const handle = handles.get(entry.ordinal);
      if (!handle?.pid || entry.reaped) return;
      const signals = [];
      const signal = name => { try { process.kill(-handle.pid, name); signals.push(name); } catch (error) { if (error.code !== 'ESRCH') entry.errors.push({ phase: 'emergency-signal', error: errorRecord(error) }); } };
      const recordClose = (code, signalName) => { entry.close = { code, signal: signalName }; };
      const recordExit = (code, signalName) => { entry.exit = { code, signal: signalName }; };
      handle.once('close', recordClose); handle.once('exit', recordExit);
      signal('SIGTERM');
      for (let attempt = 0; attempt < 80 && !(absent(handle.pid) && absent(-handle.pid)); attempt++) await delay(25);
      if (!(absent(handle.pid) && absent(-handle.pid))) { signal('SIGKILL'); for (let attempt = 0; attempt < 40 && !(absent(handle.pid) && absent(-handle.pid)); attempt++) await delay(25); }
      entry.reaped = absent(handle.pid) && absent(-handle.pid);
      entry.emergencySignals = signals;
      handle.removeListener('close', recordClose); handle.removeListener('exit', recordExit);
    },
    async closeAll() {
      for (const entry of entries) if (entry.pid && !entry.reaped) await this.emergency(entry);
      if (entries.some(entry => entry.launchAttempted && (!entry.pid || !entry.reaped || !entry.exit || !entry.close))) throw Object.assign(new Error('CHILD_CLOSURE_INCOMPLETE'), { code: 'CHILD_CLOSURE_INCOMPLETE' });
    },
    summary() {
      const attempted = entries.filter(entry => entry.launchAttempted);
      const launched = entries.filter(entry => Number.isInteger(entry.pid) && entry.pid > 0);
      const closed = launched.filter(entry => entry.reaped === true && entry.exit && entry.close);
      return { enrolled: entries.length, attempted: attempted.length, launched: launched.length, closed: closed.length, unknownAcquisitions: attempted.filter(entry => !entry.pid).length, allChildrenReaped: attempted.length === 0 ? null : launched.length === attempted.length && closed.length === launched.length, unsafe: entries.some(entry => entry.errors.length || entry.state === 'LAUNCHING' || entry.state === 'UNSAFE_STOP') };
    },
  };
}
export async function launchTracked({ ledger, kind, prepare, supervise, persist }) {
  const entry = ledger.enroll(kind);
  let phase = 'prepare';
  try {
    const prepared = await prepare(entry);
    entry.configSha = prepared.configSha;
    phase = 'supervise';
    ledger.starting(entry);
    const receipt = await supervise(prepared, (handle, state) => ledger.attach(entry, handle, state));
    ledger.complete(entry, receipt);
    phase = 'persist';
    const receiptSha = await persist(entry, receipt);
    ledger.persisted(entry, receiptSha);
    return receipt;
  } catch (error) {
    ledger.failed(entry, phase, error);
    try { await ledger.emergency(entry); } catch (cleanupError) { ledger.failed(entry, 'emergency', cleanupError); }
    throw Object.assign(new Error(`LAUNCH_UNSAFE:${phase}`, { cause: error }), { code: 'LAUNCH_UNSAFE', original: errorRecord(error), launchOrdinal: entry.ordinal });
  }
}
