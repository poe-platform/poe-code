import fs from 'node:fs';
import { encode, limits, readDocument } from './records.mjs';

const brief = error => ({ type: error === null ? 'null' : typeof error, code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null, name: typeof error?.name === 'string' ? error.name.slice(0, 80) : null });
const selected = value => ({ present: true, undefinedValue: value === undefined, value });
const evidenceValue = (value, depth = 0) => {
  if (!(value instanceof Error)) return value;
  if (depth > 8) return { name: value.name, message: value.message, nestedErrorDepthExceeded: true };
  const result = { name: value.name, message: value.message, stack: value.stack, code: value.code };
  for (const key of ['cause', 'primary', 'cleanup']) if (Object.hasOwn(value, key)) result[key] = { present: true, undefinedValue: value[key] === undefined, value: evidenceValue(value[key], depth + 1) };
  return result;
};
const evidenceSelection = selection => ({ ...selection, value: evidenceValue(selection.value) });
const write = (descriptor, bytes) => {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(count) || count <= 0) throw Object.assign(new Error('TERMINAL_ZERO_WRITE'), { code: 'TERMINAL_ZERO_WRITE' });
    offset += count;
  }
};

export function publish({ output, ledger, store, inheritedExitCode = 0, writeStream = write }) {
  const failures = [];
  const accounting = ledger.summary();
  const children = ledger.entries;
  const primaryPresent = Object.hasOwn(output, 'fatal');
  const primary = primaryPresent ? selected(output.fatal) : { present: false };
  const failedRows = [output.controls, output.cohort].some(group => group?.rows?.some(row => row.pass === false));
  let unsafe = output.unsafe === true || accounting.unsafe === true || primaryPresent || inheritedExitCode !== 0;
  if (accounting.launched && accounting.allChildrenReaped !== true) unsafe = true;
  let status = unsafe ? 'UNSAFE_STOP' : output.status;
  let exitCode = inheritedExitCode || (unsafe || failedRows || status === 'ADMISSION_FAILED' ? 1 : 0);
  const summaryChildren = children.map(child => ({ ordinal: child.ordinal, pid: child.pid, group: child.group, exit: child.exit, close: child.close, reaped: child.reaped, persisted: child.persisted }));
  let reference = null;
  const recordFailure = (phase, error) => { failures.push({ phase, selected: selected(error) }); unsafe = true; status = 'UNSAFE_STOP'; exitCode ||= 1; };
  try {
    reference = store.save('RESULT.json', { ...output, ...(primaryPresent ? { fatal: evidenceValue(output.fatal) } : {}), status, unsafe, selectedPrimary: evidenceSelection(primary), children, launchAccounting: accounting, publication: { protocol: 'BOUNDED_REPORT_V1', requiresTerminalAndExitZeroForAcceptance: true } });
  } catch (error) { recordFailure('result-publication', error); }
  const terminal = () => ({ schema: 'BOUNDED_TERMINAL_V1', mode: output.mode, runId: output.runId, status, unsafe, exitCode, primary: primaryPresent ? { present: true, ...brief(output.fatal) } : { present: false }, result: reference, launchAccounting: accounting, children: summaryChildren, failures: failures.map(row => ({ phase: row.phase, ...brief(row.selected.value) })), historicalScoresUnchanged: true });
  if (failures.length) {
    try { store.save('PUBLICATION-FAILURE.json', { ...terminal(), selectedPrimary: evidenceSelection(primary), failures: failures.map(row => ({ phase: row.phase, selected: evidenceSelection(row.selected) })) }); }
    catch (error) { recordFailure('failure-publication', error); }
  }
  try { writeStream(1, encode(terminal(), Math.min(32768, limits.stream))); }
  catch (error) {
    recordFailure('stdout', error);
    try { store.save('TERMINAL-FAILURE.json', { ...terminal(), selectedPrimary: evidenceSelection(primary), failures: failures.map(row => ({ phase: row.phase, selected: evidenceSelection(row.selected) })) }); }
    catch (persistenceError) { recordFailure('terminal-failure-publication', persistenceError); }
    try { writeStream(2, encode(terminal(), Math.min(32768, limits.stream))); }
    catch (stderrError) { recordFailure('stderr', stderrError); }
  }
  return { status, unsafe, exitCode, reference, primary, failures, accounting, children: summaryChildren };
}

export function assessTerminal(receipt, root) {
  if (receipt.exit?.code !== 0 || receipt.close?.code !== 0 || receipt.exit?.signal || receipt.close?.signal || receipt.reaped !== true || receipt.stdout.length > limits.stream || receipt.stderr.length !== 0) return false;
  let row;
  try { row = JSON.parse(receipt.stdout.toString('utf8')); } catch { return false; }
  let artifact;
  try { artifact = readDocument(root, row.result.path, row.result.sha256); } catch { return false; }
  return row.schema === 'BOUNDED_TERMINAL_V1' && row.status === 'ADMISSION_ACCEPTED' && row.unsafe === false && row.exitCode === 0 && row.failures.length === 0 && row.launchAccounting.unsafe === false && (row.launchAccounting.launched === 0 || row.launchAccounting.allChildrenReaped === true) && artifact.status === row.status && artifact.unsafe === false && artifact.mode === row.mode && artifact.runId === row.runId && JSON.stringify(artifact.launchAccounting) === JSON.stringify(row.launchAccounting);
}
