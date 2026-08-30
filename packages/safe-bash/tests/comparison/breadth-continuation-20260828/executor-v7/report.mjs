import fs from 'node:fs';
import path from 'node:path';
import { encode, readDocument } from './records.mjs';
import { dataObject, denseArray, hashString, nonnegative } from './schema.mjs';
import { parseTransport } from '../executor-v3/transport.mjs';

export function reason(value, depth = 0) {
  try {
    if (!(value instanceof Error)) return value;
    const own = Object.getOwnPropertyDescriptors(value);
    const field = name => own[name] && Object.hasOwn(own[name], 'value') ? own[name].value : undefined;
    if (depth > 8) return { name: 'Error', nestedReasonLimit: true };
    const result = { name: typeof field('name') === 'string' ? field('name') : 'Error', message: field('message'), stack: field('stack'), code: field('code') };
    for (const key of ['primary', 'cause', 'original', 'cleanup']) if (own[key]) result[key] = { present: true, undefinedValue: field(key) === undefined, value: Array.isArray(field(key)) ? field(key).map(item => reason(item, depth + 1)) : reason(field(key), depth + 1) };
    return result;
  } catch { return { uninspectableReason: true }; }
}
export const selection = value => ({ present: true, undefinedValue: value === undefined, value: reason(value) });
const writeDefault = (descriptor, bytes) => {
  let offset = 0;
  while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); if (count <= 0) throw new Error('TERMINAL_ZERO_WRITE'); offset += count; }
};

export function publish({ output, ledger, store, inheritedExitCode = 0, audit = () => {}, writeStream = writeDefault }) {
  const failures = [];
  let primary = { present: false };
  let accounting = { enrolled: 0, attempted: 0, launched: 0, closed: 0, unknownAcquisitions: 0, allChildrenReaped: null, unsafe: true };
  let children = [];
  let status = 'UNSAFE_STOP';
  let unsafe = true;
  let reference = null;
  let exitCode = inheritedExitCode || 1;
  const failed = (phase, error) => { failures.push({ phase, reason: selection(error) }); status = 'UNSAFE_STOP'; unsafe = true; exitCode ||= 1; };
  try {
    if (Object.hasOwn(output, 'fatal')) primary = selection(output.fatal);
    children = ledger.entries.map(child => ({ ordinal: child.ordinal, pid: child.pid, group: child.group, exit: child.exit, close: child.close, reaped: child.reaped, persisted: child.persisted }));
    accounting = ledger.summary();
    const badRows = [output.controls, output.cohort].some(group => group?.rows?.some(row => row.pass === false));
    unsafe = output.unsafe === true || accounting.unsafe || primary.present || inheritedExitCode !== 0 || (accounting.launched > 0 && accounting.allChildrenReaped !== true);
    status = unsafe ? 'UNSAFE_STOP' : output.status;
    exitCode = inheritedExitCode || (unsafe || badRows || status === 'ADMISSION_FAILED' ? 1 : 0);
    if (store) reference = store.save('RESULT.json', { ...output, ...(primary.present ? { fatal: reason(output.fatal) } : {}), selectedPrimary: primary, status, unsafe, children: ledger.entries, launchAccounting: accounting, requiresNaturalSupervisorReceipt: true });
    else throw Object.assign(new Error('REPORT_STORE_UNAVAILABLE'), { code: 'REPORT_STORE_UNAVAILABLE' });
    audit();
  } catch (error) { failed('prepare-or-publication', error); }
  const terminal = () => ({ schema: 'BOUNDED_TERMINAL_V2', mode: typeof output?.mode === 'string' ? output.mode.slice(0, 16) : 'unknown', runId: typeof output?.runId === 'string' ? output.runId.slice(0, 64) : 'unknown', status, unsafe, exitCode, primary: { present: primary.present, undefinedValue: primary.undefinedValue === true }, result: reference, launchAccounting: accounting, children, failures: failures.map(entry => ({ phase: entry.phase, code: typeof entry.reason.value?.code === 'string' ? entry.reason.value.code.slice(0, 80) : null })), historicalScoresUnchanged: true });
  if (failures.length && store) {
    try { store.save('PUBLICATION-FAILURE.json', { selectedPrimary: primary, failures, terminal: terminal() }); audit(); }
    catch (error) { failed('failure-publication', error); }
  }
  try { writeStream(1, encode(terminal(), 32768)); }
  catch (error) {
    failed('stdout', error);
    if (store) { try { store.save('TERMINAL-FAILURE.json', { selectedPrimary: primary, failures, terminal: terminal() }); audit(); } catch (later) { failed('terminal-failure-publication', later); } }
    try { writeStream(2, encode(terminal(), 32768)); } catch (later) { failed('stderr', later); }
  }
  return { status, unsafe, exitCode, reference, selectedPrimary: primary, failures, accounting, children };
}

const exitShape = value => { const row = dataObject(value, ['code', 'signal']); return row && row.code === 0 && row.signal === null; };
function accountingShape(value) {
  const row = dataObject(value, ['enrolled', 'attempted', 'launched', 'closed', 'unknownAcquisitions', 'allChildrenReaped', 'unsafe']);
  return row && ['enrolled', 'attempted', 'launched', 'closed', 'unknownAcquisitions'].every(key => nonnegative(row[key]) && row[key] <= 99) && row.enrolled === row.attempted && row.attempted === row.launched && row.launched === row.closed && row.unknownAcquisitions === 0 && row.unsafe === false && (row.launched === 0 ? row.allChildrenReaped === null : row.allChildrenReaped === true) ? row : null;
}
function decode(value, observed, maximum) {
  if (typeof value !== 'string' || !nonnegative(observed) || observed > maximum || value.length > 4 * Math.ceil(maximum / 3)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === observed && bytes.toString('base64') === value ? bytes : null;
}

export function assessTerminal(receipt, root, { syntheticOnly = false } = {}) {
  try {
    const received = dataObject(receipt, ['pid', 'exit', 'close', 'reaped', 'failures', 'signals', 'records', 'captureBytes', 'stdout', 'stderr', 'rawRecords', 'natural']);
    if (!received || !Number.isSafeInteger(received.pid) || received.pid <= 0 || !exitShape(received.exit) || !exitShape(received.close) || received.reaped !== true || received.natural !== true) return false;
    const failures = denseArray(received.failures, 64), signals = denseArray(received.signals, 64), records = denseArray(received.records, 8192);
    if (!failures || !signals || !records || failures.length || signals.length) return false;
    const counts = dataObject(received.captureBytes, ['stdout', 'stderr', 'records']);
    if (!counts) return false;
    const stdout = decode(received.stdout, counts.stdout, 65536), stderr = decode(received.stderr, counts.stderr, 65536), raw = decode(received.rawRecords, counts.records, 262144);
    if (!stdout?.length || !stderr || stderr.length || !raw?.length) return false;
    const parsedRecords = parseTransport(raw);
    if (encode(records, 262144).toString() !== encode(parsedRecords, 262144).toString()) return false;
    const row = dataObject(JSON.parse(stdout.toString('utf8')), ['schema', 'mode', 'runId', 'status', 'unsafe', 'exitCode', 'primary', 'result', 'launchAccounting', 'children', 'failures', 'historicalScoresUnchanged']);
    if (!row || row.schema !== 'BOUNDED_TERMINAL_V2' || row.mode !== 'admission' || typeof row.runId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(row.runId) || row.status !== 'ADMISSION_ACCEPTED' || row.unsafe !== false || row.exitCode !== 0 || row.historicalScoresUnchanged !== true) return false;
    const primary = dataObject(row.primary, ['present', 'undefinedValue']);
    const terminalFailures = denseArray(row.failures, 64), children = denseArray(row.children, 99), accounting = accountingShape(row.launchAccounting);
    if (!primary || primary.present !== false || primary.undefinedValue !== false || !terminalFailures || terminalFailures.length || !children || !accounting || children.length !== accounting.enrolled) return false;
    for (let index = 0; index < children.length; index++) {
      const child = dataObject(children[index], ['ordinal', 'pid', 'group', 'exit', 'close', 'reaped', 'persisted']);
      if (!child || child.ordinal !== index + 1 || !Number.isSafeInteger(child.pid) || child.pid <= 0 || child.group !== -child.pid || child.reaped !== true || child.persisted !== true) return false;
      const childExit = dataObject(child.exit, ['code', 'signal']), childClose = dataObject(child.close, ['code', 'signal']);
      if (!childExit || !childClose || childExit.code !== childClose.code || childExit.signal !== childClose.signal) return false;
    }
    const reference = dataObject(row.result, ['path', 'bytes', 'sha256', 'mode']);
    if (!reference || reference.path !== 'RESULT.json' || !hashString(reference.sha256) || !nonnegative(reference.bytes) || reference.bytes > 262144 || reference.mode !== 0o644) return false;
    if (fs.lstatSync(path.join(root, reference.path)).size !== reference.bytes) return false;
    const artifact = readDocument(root, reference.path, reference.sha256);
    if (!artifact || typeof artifact !== 'object' || artifact.status !== row.status || artifact.unsafe !== false || artifact.mode !== row.mode || artifact.runId !== row.runId || artifact.admissionQualified !== true || artifact.requiresNaturalSupervisorReceipt !== true) return false;
    if (artifact.authorityClass !== (syntheticOnly ? 'SYNTHETIC_ONLY' : 'COMMITTED_ROOT_REVIEW')) return false;
    if (!denseArray(artifact.authorizationMetadata, 4) || artifact.authorizationMetadata.some(child => child.reaped !== true || child.status !== 0 || child.signal !== null || child.errorCode !== null)) return false;
    return encode(artifact.launchAccounting, 8192).toString() === encode(row.launchAccounting, 8192).toString();
  } catch { return false; }
}
