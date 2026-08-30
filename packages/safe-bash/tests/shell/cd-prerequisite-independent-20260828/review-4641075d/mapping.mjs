import assert from 'node:assert/strict';
import { posix } from 'node:path';

export function materialize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value.repeat)) return value.repeat[0].repeat(value.repeat[1]);
  if (Array.isArray(value.concat)) return value.concat.map(materialize).join('');
  if (Array.isArray(value)) return value.map(materialize);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, materialize(entry)]));
}

export function scenario(row, defaults) {
  const diagnostic = row.id.startsWith('D');
  const input = materialize(row.input ?? {});
  const env = { ...defaults.env, ...input.env };
  for (const [key, value] of Object.entries(env)) if (value === null) delete env[key];
  const cwd = input.cwd ?? defaults.cwd;
  const expected = materialize(row.expected ?? { cdStatus: 1, stdout: '', state: 'initial-unchanged' });
  const source = diagnostic ? 'cd /d' : input.source ?? defaults.source;
  const suffix = input.observeSuffix ?? defaults.observeSuffix;
  let calls = Array.isArray(expected.calls) ? expected.calls : [];
  const step = (method, path, result) => ({ method, path, ...(method === 'access' ? { mode: 1 } : {}), result });
  if (['O02', 'O03', 'O04'].includes(row.id)) calls = [step('stat', '/p/t', 'directory'), step('access', '/p/t', 'success')];
  if (['L08', 'L22', 'L24'].includes(row.id)) calls = [step('stat', env.TARGET, 'directory'), step('access', env.TARGET, 'success')];
  if (['L18', 'L19', 'L20', 'L21'].includes(row.id)) {
    const probes = expected.statCalls;
    const path = posix.resolve(cwd, 't');
    calls = [];
    for (let index = 0; index < probes; index++) {
      const file = row.id === 'L20' && index < 4;
      calls.push(step('stat', path, file ? 'file' : 'directory'));
      if (file || row.id === 'L20' && index === probes - 1) continue;
      const success = ['L18', 'L19'].includes(row.id) && index === probes - 1;
      calls.push(step('access', path, success ? 'success' : { kind: 'FsError', code: 'EACCES', syscall: 'access', path }));
    }
  }
  if (diagnostic) calls = [step('stat', '/d', { kind: 'diagnostic-message', payload: materialize(row.payload) })];
  if (['L08', 'L19', 'L22', 'L24'].includes(row.id)) expected.state = { cwd: calls[0].path, PWD: calls[0].path, OLDPWD: cwd, exportAdditions: ['PWD', 'OLDPWD'] };
  return { id: row.id, group: diagnostic ? 'diagnostics' : row.group, diagnostic, input, expected, env, cwd, source: source + suffix, builtinSource: source, calls, row };
}

export const sourceReviewFields = new Set([
  'order', 'events', 'stateInvariant', 'childState', 'readonly', 'noReadonlyAttributeRemoval',
  'publications', 'publication', 'noModeInferenceInCd', 'noPerByteCommandCharges',
  'work', 'yields', 'finalYieldRemainder', 'firstYieldAfterChargedUnits', 'chargedPrivateUnits',
  'rawReserved', 'failedReservation', 'remaining', 'failedOperation', 'unconstrainedWork',
  'cdpathScannedBytes', 'unusedCwdScannedBytes', 'controllerReset', 'commandsAdmitted',
  'finalErrorCode', 'namespaceOtherChanges',
]);

export const descriptiveFields = new Set([
  'raw', 'rawBytes', 'normalizedBytes', 'effectiveTarget', 'searchSlots', 'freshFallback',
  'candidateBytes', 'pathBytes', 'inputCwdBytes', 'effectiveBytes', 'rawCandidateBytes',
  'hypotheticalNormalized', 'cdpathBytes', 'firstViolationAtByte', 'firstByteAndSlotOverflowTogether',
  'targetBytes', 'targetUtf16Units', 'nativeClaim', 'serviceExecuted', 'guard', 'selected',
]);

export const publicFields = new Set([
  'cdStatus', 'stdout', 'stderr', 'state', 'calls', 'forbidden', 'printCount', 'diagnosticPayload',
  'laterSuccessFixtureMustRemainUncalled', 'callerSignalAborted', 'backingCalls', 'writes', 'backingAccess',
  'transportRequests', 'restored', 'fileAfter', 'capturedBytes', 'externalWriteAttempts',
  'externalStderrWriteAttempts', 'execRejects', 'diagnosticPayloadBytes', 'physicalStderrBytes',
  'suffixAdded', 'rejects', 'laterCalls', 'lateUnhandledRejections', 'cleanup', 'externalWriteAttempt',
  'statCalls', 'accessCalls', 'publicVfsCalls', 'privateFailureBeforeRejection', 'stdoutWriteAttempts',
]);

export function coverage(data) {
  const all = [...data.cases, ...data.diagnosticCases];
  return all.map(row => {
    const plan = scenario(row, data.defaults);
    for (const key of Object.keys(plan.expected)) assert(publicFields.has(key) || sourceReviewFields.has(key) || descriptiveFields.has(key), `${row.id}: unmapped expected field ${key}`);
    const sourceFields = Object.keys(plan.expected).filter(key => sourceReviewFields.has(key));
    if (row.id === 'L26') sourceFields.push('state');
    return {
      id: row.id, group: plan.group, modes: ['source', 'installed', 'moved'],
      publicExecutor: 'fixtures.mjs:executeCase', publicAssertions: Object.keys(plan.expected).filter(key => !sourceFields.includes(key) && !descriptiveFields.has(key)),
      sourceReviewFields: sourceFields,
      sourceReviewStatus: sourceFields.length ? 'candidate-source-review-pending; no private helper names or instrumentation assumed' : 'not-required-for-row-specific-fields',
      accountingRecipes: Object.keys(plan.expected).filter(key => descriptiveFields.has(key)),
      exactCalls: plan.calls.length,
      status: 'NOT RUN', frozenDefinition: `cases-v1.mjs:${row.id}`,
    };
  });
}

export function scalarPayload(row) {
  const input = materialize(row.payload);
  if (!row.truncated) return input;
  let count = 0;
  const prefix = [];
  for (const scalar of input) {
    const bytes = Buffer.byteLength(scalar);
    if (count + bytes > 65780) break;
    count += bytes;
    prefix.push(scalar);
  }
  assert.equal(count, row.retainedBytes);
  const result = prefix.join('') + ' [truncated]';
  assert.equal(Buffer.byteLength(result), row.outputBytes);
  return result;
}

export function expectedState(plan) {
  const initial = { ...plan.env, PWD: plan.cwd };
  const state = plan.expected.state;
  if (!state) return undefined;
  if (state === 'initial-unchanged') return { cwd: plan.cwd, PWD: initial.PWD, OLDPWD: initial.OLDPWD ?? '', env: initial };
  const exported = { ...initial };
  if (state.exported !== 'initial') {
    if (state.PWD !== undefined) exported.PWD = state.PWD;
    if (state.OLDPWD !== undefined) exported.OLDPWD = state.OLDPWD;
  }
  for (const key of state.exportedAbsent ?? []) delete exported[key];
  for (const [key, value] of Object.entries(plan.expected.restored ?? {})) exported[key] = value;
  return { ...state, env: exported };
}
