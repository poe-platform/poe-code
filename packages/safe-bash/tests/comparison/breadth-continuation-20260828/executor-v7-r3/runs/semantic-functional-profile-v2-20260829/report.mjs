import {aggregateInvocations,reasonData} from './invocations.mjs';
import {functionalProfile} from './functional-profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { encode, readDocument } from '../../../executor-v7-r2/records.mjs';
import { dataObject, denseArray, hashString, nonnegative } from '../../../executor-v7-r2/schema.mjs';
import { parseTransport } from '../../../executor-v3/transport.mjs';
import { dispositionData, childLedgerData, envelopeData, authorityReceiptData } from '../../../executor-v7-r2/contracts.mjs';

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
  const invocationAccounting=accountingReport(output);
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
    unsafe = !invocationAccounting.qualified || output.unsafe === true || accounting.unsafe || primary.present || inheritedExitCode !== 0 || (accounting.launched > 0 && accounting.allChildrenReaped !== true);
    status = unsafe ? 'UNSAFE_STOP' : output.status;
    exitCode = inheritedExitCode || (unsafe || badRows || status === 'ADMISSION_FAILED' ? 1 : 0);
    if (store) reference = store.save('RESULT.json', { ...output, ...(primary.present ? { fatal: reason(output.fatal) } : {}), selectedPrimary: primary, status, unsafe, children: ledger.entries, launchAccounting: accounting, requiresNaturalWorkers: true, semanticProtocol: 'SEMANTIC_RESULT_V2', functionalProfile, invocationAccounting, legacyCompletedCounts: countExec(output), execCounts: countExec(output), caseCounts: countCases(output) });
    else throw Object.assign(new Error('REPORT_STORE_UNAVAILABLE'), { code: 'REPORT_STORE_UNAVAILABLE' });
    audit();
  } catch (error) { failed('prepare-or-publication', error); }
  const terminal = () => ({ schema: 'BOUNDED_SEMANTIC_TERMINAL_V2', mode: typeof output?.mode === 'string' ? output.mode.slice(0, 16) : 'unknown', runId: typeof output?.runId === 'string' ? output.runId.slice(0, 64) : 'unknown', status, unsafe, exitCode, primary: { present: primary.present, undefinedValue: primary.undefinedValue === true }, result: reference, functionalProfile, invocationAccounting, legacyCompletedCounts: countExec(output), execCounts: countExec(output), caseCounts: countCases(output), launchAccounting: accounting, children, failures: failures.map(entry => ({ phase: entry.phase, code: typeof entry.reason.value?.code === 'string' ? entry.reason.value.code.slice(0, 80) : null })), historicalScoresUnchanged: true });
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


export function countExec(output) { return { semantic: output.productCohortCalls, emptySetup: output.setupCalls, C11: 0, total: output.productCohortCalls + output.setupCalls }; }
export function countCases(output) {
  const rows = output.cohort?.rows ?? [];
  const complete = rows.filter(row => row.safe === true);
  return { completed: complete.length, passed: complete.filter(row => row.pass === true).length, failed: complete.filter(row => row.pass === false).length, unqualified: complete.filter(row => row.pass === null).length, unrun: 99 - complete.length };
}
export { assessSemanticTerminal } from './semantic-assessor.mjs';

export function accountingReport(output){try{if(output.functionalProfile!==functionalProfile||!denseArray(output.invocationAccountingErrors,99))throw Error('INVOCATION_ACCOUNTING_SCHEMA');const counts=aggregateInvocations(output.invocationRows);return {schema:'INVOCATION_ACCOUNTING_V2',qualified:output.invocationAccountingErrors.length===0,counts,errors:output.invocationAccountingErrors.map(row=>({operationId:row.operationId,reason:reasonData(row.error)}))};}catch(error){return {schema:'INVOCATION_ACCOUNTING_V2',qualified:false,counts:null,errors:[{operationId:null,reason:reasonData(error)}]};}}

