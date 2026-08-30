import { dataObject, denseArray, hashString, nonnegative } from './schema.mjs';
import { relativeName } from '../executor-v4/safety.mjs';

export const wireLimits = Object.freeze({ config: 2097151, staged: 2097152, record: 262144, metadata: 65536 });
export const primitiveCommit = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const runIdentifier = value => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
export function referenceData(value) {
  try {
    const row = dataObject(value, ['commit', 'path', 'sha256']);
    if (!row || !primitiveCommit(row.commit) || typeof row.path !== 'string' || !hashString(row.sha256)) return null;
    relativeName(row.path); return row;
  } catch { return null; }
}
export function envelopeData(value) {
  const row = dataObject(value, ['review', 'grant']);
  if (!row) return null;
  const review = referenceData(row.review), grant = referenceData(row.grant);
  return review && grant ? { review, grant } : null;
}
export function reviewData(value) {
  const row = dataObject(value, ['role', 'verdict', 'recipeSha256']);
  return row && row.role === 'different-reviewer' && row.verdict === 'PREEXECUTION_ACCEPTED' && hashString(row.recipeSha256) ? row : null;
}
export function grantData(value) {
  const base = ['role', 'phase', 'attempts', 'runId', 'outputRoot', 'recipeSha256', 'reviewSha256', 'planSha256', 'bootstrapProfile', 'reportProtocol', 'candidate', 'packSha256', 'command'];
  const row = dataObject(value, base, ['acceptedAdmission']);
  if (!row || row.role !== 'root' || !['admission', 'cohort'].includes(row.phase) || row.attempts !== 1 || !runIdentifier(row.runId) || typeof row.outputRoot !== 'string' || !row.outputRoot.startsWith('/') || !primitiveCommit(row.candidate)) return null;
  if (!['recipeSha256', 'reviewSha256', 'planSha256', 'packSha256'].every(key => hashString(row[key])) || row.bootstrapProfile !== 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1' || row.reportProtocol !== 'BOUNDED_TERMINAL_V3') return null;
  const command = dataObject(row.command, ['entry', 'phase', 'runId', 'nodeArgs']);
  const args = command && denseArray(command.nodeArgs, 2);
  if (!command || command.entry !== 'coordinator.mjs' || command.phase !== row.phase || command.runId !== row.runId || !args || args.length !== 2 || args[0] !== '--unhandled-rejections=strict' || args[1] !== '--max-old-space-size=256') return null;
  if (row.phase === 'admission' && Object.hasOwn(row, 'acceptedAdmission')) return null;
  if (row.phase === 'cohort') {
    const accepted = dataObject(row.acceptedAdmission, ['path', 'sha256']);
    if (!accepted || typeof accepted.path !== 'string' || !hashString(accepted.sha256)) return null;
    try { relativeName(accepted.path); } catch { return null; }
  }
  return row;
}
export function dispositionData(value) {
  const row = dataObject(value, ['code', 'signal']);
  if (!row) return null;
  const numeric = nonnegative(row.code) && row.code <= 255;
  const signal = typeof row.signal === 'string' && /^SIG[A-Z0-9]{1,61}$/.test(row.signal);
  return (numeric && row.signal === null) || (row.code === null && signal) ? row : null;
}
export function authorityReceiptData(value, ordinal, reference, syntheticOnly = false) {
  const row = dataObject(value, ['role', 'ordinal', 'reference', 'pid', 'group', 'status', 'signal', 'errorCode', 'stdoutBytes', 'stdoutSha256', 'stderrBase64', 'reaped']);
  const binding = row && referenceData(row.reference), expected = referenceData(reference);
  if (!row || !binding || !expected || row.role !== (syntheticOnly ? 'synthetic-authority-metadata' : 'git-authority-metadata') || row.ordinal !== ordinal || !Number.isSafeInteger(row.pid) || row.pid <= 0 || row.group !== -row.pid || row.status !== 0 || row.signal !== null || row.errorCode !== null || !Number.isSafeInteger(row.stdoutBytes) || row.stdoutBytes < 1 || row.stdoutBytes > wireLimits.metadata || row.stdoutSha256 !== expected.sha256 || row.stderrBase64 !== '' || row.reaped !== true) return null;
  return ['commit', 'path', 'sha256'].every(key => binding[key] === expected[key]) ? row : null;
}
export function childLedgerData(value, ordinal) {
  const row = dataObject(value, ['ordinal', 'kind', 'state', 'launchAttempted', 'pid', 'group', 'exit', 'close', 'reaped', 'persisted', 'errors', 'operationId', 'operationOrdinal', 'configSha', 'natural', 'failures', 'signals', 'receiptSha']);
  if (!row || row.ordinal !== ordinal || !['probe', 'control', 'C11', 'case'].includes(row.kind) || row.state !== 'PERSISTED' || row.launchAttempted !== true || !Number.isSafeInteger(row.pid) || row.pid <= 0 || row.group !== -row.pid || row.reaped !== true || row.persisted !== true || typeof row.operationId !== 'string' || !row.operationId.length || !Number.isSafeInteger(row.operationOrdinal) || row.operationOrdinal < 1 || !hashString(row.configSha) || !hashString(row.receiptSha)) return null;
  const exit = dispositionData(row.exit), close = dispositionData(row.close);
  const errors = denseArray(row.errors, 0), failures = denseArray(row.failures, 1), signals = denseArray(row.signals, 1);
  if (!exit || !close || exit.code !== close.code || exit.signal !== close.signal || !errors || !failures || !signals) return null;
  if (row.operationId === 'C09-deadline') {
    const failure = failures.length === 1 && dataObject(failures[0], ['code']);
    if (row.kind !== 'control' || exit.code !== 0 || exit.signal !== null || row.natural !== false || failure?.code !== 'NATURAL_DEADLINE' || signals.length !== 1 || signals[0] !== 'SIGTERM') return null;
  } else {
    const expected = row.operationId === 'C09-status' ? 7 : 0;
    if (expected === 7 && row.kind !== 'control') return null;
    if (exit.code !== expected || exit.signal !== null || row.natural !== (expected === 0) || failures.length || signals.length) return null;
  }
  return row;
}
