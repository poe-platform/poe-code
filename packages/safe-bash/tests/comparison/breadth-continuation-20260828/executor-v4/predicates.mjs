import { assessWorkflow as original } from '../executor-preparation-v1/predicates.mjs';
import { assess as legacy } from '../executor-preparation-v1/legacy-assess.mjs';
import { settled } from './safety.mjs';

const channels = ['inputAdmission', 'chunks', 'dispatch', 'timers', 'iteratorCleanup'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function validateTelemetry(engine, telemetry) {
  const errors = [];
  if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) return ['missing-telemetry'];
  if (JSON.stringify(Object.keys(telemetry).sort()) !== JSON.stringify([...channels].sort())) errors.push('exact-channel-membership');
  for (const name of channels) {
    const value = telemetry[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(name); continue; }
    if (name === 'inputAdmission') {
      if (value.status !== (engine === 'just-bash' ? 'OBSERVABLE_BYTE_ADMISSION' : 'OBSERVABLE_CHUNK_ADMISSION') || value.inputBase64 !== 'AP9BCg2AAA==') errors.push(name);
    } else if (engine === 'just-bash' || name === 'timers') {
      if (value.status !== 'UNQUALIFIED' || typeof value.reason !== 'string' || value.reason.length === 0) errors.push(name);
    } else {
      if (!['QUALIFIED', 'FAILED'].includes(value.status)) errors.push(`${name}:status`);
      if (name === 'dispatch') {
        if (!integer(value.catCount) || !Array.isArray(value.events) || value.events.length > 256 || value.events.some(event => typeof event?.command !== 'string') || value.events.filter(event => event.command === 'cat').length !== value.catCount || (value.status === 'QUALIFIED' && value.catCount !== 1)) errors.push(name);
      } else {
        const receipt = value.receipt;
        if (!receipt || !['acquire', 'next', 'returns', 'settled', 'active', 'yieldedBytes'].every(key => integer(receipt[key])) || !Array.isArray(receipt.yieldedLengths) || receipt.yieldedLengths.some(length => !integer(length))) { errors.push(name); continue; }
        if (value.status === 'QUALIFIED' && (name === 'chunks' ? JSON.stringify(receipt.yieldedLengths) !== '[1,2,1,3]' || receipt.yieldedBytes !== 7 : receipt.acquire < 1 || receipt.active !== 0 || receipt.settled !== receipt.acquire)) errors.push(name);
      }
    }
  }
  return errors;
}
export function assessWorkflow(specimen, report, engine) {
  if (specimen.id === 'W07' && engine === 'just-bash') {
    const assessment = original(specimen, report);
    const byteChecks = assessment.checks.filter(check => ['STATUS', 'STDOUT_BYTES', 'STDERR_BYTES'].includes(check.id));
    const otherFailures = assessment.checks.filter(check => !check.pass && check.id !== 'OBSERVATION:No fixture executable is executed');
    return { ...assessment, pass: otherFailures.length ? false : null, status: otherFailures.length ? 'FAILED' : 'UNQUALIFIED_UNCREDITED', semanticCredit: false, nonExecutionCredit: false, matchingBytesOnly: byteChecks.length === 3 && byteChecks.every(check => check.pass), observerQualifications: { nonExecution: 'UNQUALIFIED', dispatch: 'UNOBSERVABLE' }, obligation: 'All original observations retained; no semantic/non-execution credit from bytes.' };
  }
  if (specimen.id !== 'W03') return original(specimen, report);
  const semantics = original({ ...specimen, additionalObservations: [] }, report);
  const invalid = validateTelemetry(engine, report.telemetry);
  const failed = Object.values(report.telemetry ?? {}).some(value => value?.status === 'FAILED');
  return { ...semantics, sharedSemanticsPass: semantics.pass, pass: !semantics.pass || failed || invalid.length ? false : null, status: invalid.length ? 'INVALID_TELEMETRY' : !semantics.pass || failed ? 'FAILED' : 'SHARED_SEMANTICS_QUALIFIED_TELEMETRY_UNQUALIFIED', invalid, completeTelemetryQualified: false, telemetry: report.telemetry ?? null };
}
export function qualify(specimen, report, child, integrity, engine) {
  const own = (object, key) => Object.hasOwn(object ?? {}, key);
  const schemaValid = Array.isArray(report?.late) && report.late.length === 0 && Array.isArray(report?.loads?.denied) && report.loads.denied.length === 0 && report.postGuard === true && !(own(report, 'executionError') && own(report, 'result'));
  const safe = schemaValid && settled(child) && integrity === true && report?.cleanup?.completion === 'returned' && !report.cleanup.error && report?.captureErrors?.length === 0 && report?.safety?.safe === true && report?.loads?.count > 0 && report?.loads?.evaluated === true && report?.resources?.pending === 0 && report?.resources?.violations?.length === 0;
  if (!safe) return { safe: false, pass: false, status: 'UNSAFE_STOP' };
  const assessment = specimen.id.startsWith('W') ? assessWorkflow(specimen, report, engine) : legacy(specimen, { report, exitCode: 0, signal: null, parentTimeout: false });
  if (assessment.status === 'UNQUALIFIED_UNCREDITED') return { safe: true, pass: null, status: assessment.status, assessment, semanticCredit: false, nonExecutionCredit: false };
  return { safe: true, pass: specimen.id.startsWith('W') ? assessment.pass === true || assessment.status === 'SHARED_SEMANTICS_QUALIFIED_TELEMETRY_UNQUALIFIED' : assessment.operationalCredit === true, assessment, telemetryFullyQualified: specimen.id === 'W03' ? false : null };
}
