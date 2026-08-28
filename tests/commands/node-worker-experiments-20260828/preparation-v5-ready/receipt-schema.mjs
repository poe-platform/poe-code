import { exact, integer, text, control } from './wire.mjs';
const boolean = value => { if (typeof value !== 'boolean') throw Error('boolean required'); return value; };
const enumeration = (value, choices) => { if (typeof value !== 'string' || !choices.includes(value)) throw Error('enum required'); return value; };
export function list(value, maximum, validate) {
  if (!Array.isArray(value)) throw Error('array required');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value')) throw Error('array length descriptor');
  integer(length.value, 0, maximum);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1 || keys.at(-1) !== 'length') throw Error('array extras');
  for (let index = 0; index < length.value; index += 1) {
    if (keys[index] !== String(index)) throw Error('array hole/order');
    const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('array accessor');
    validate(descriptor.value, index);
  }
  return value;
}
export const provenances = ['caller', 'escaping-parent', 'late-parent-secondary', 'undelivered-parent', 'cleanup', 'worker-control', 'capture-control', 'construction-control', 'termination-control'];
export function receiptSchema(value) {
  const record = exact(value, ['case','session','status','rawOutcomeRequiresActualHostMapping','raw','privateFailures','facts','events','effects','stdout','stderr','terminal','outcomes','reservationPeak','guestJobs','captureBytes','loadAttestation','heapEnforcement']);
  text(record.case, 64); integer(record.session, 1, 11);
  if (record.status !== null) integer(record.status, 0, 2);
  boolean(record.rawOutcomeRequiresActualHostMapping); integer(record.privateFailures, 0, 1024);
  list(record.raw, 1024, value => { const row = exact(value, ['provenance','present','callerIdentity','sinkIdentity','cleanupIdentity']); enumeration(row.provenance, provenances); if (row.present !== true) throw Error('reason presence'); boolean(row.callerIdentity); boolean(row.sinkIdentity); boolean(row.cleanupIdentity); });
  const facts = exact(record.facts, ['admission','acquisition','exited','exitCode','ordinal','cleanupClosed','cleanupSettled']);
  boolean(facts.admission); enumeration(facts.acquisition, ['not-attempted','proven-none','constructing','unconfirmed','acquired']); boolean(facts.exited); if (facts.exitCode !== null) integer(facts.exitCode, 0, 255); integer(facts.ordinal, 0, 129); boolean(facts.cleanupClosed); boolean(facts.cleanupSettled);
  list(record.events, 1024, value => { const event = exact(value, ['kind','seq','bytes']); enumeration(event.kind, ['ready','file-effect','output-published','operation-cleanup-closed','effect-admitted','final-ack-not-delivery','postcopy-marker-received','cutoff','termination-requested','worker-exit','parent-cleanup-closed']); integer(event.seq, 0, 129); integer(event.bytes, 0, 1048576); });
  list(record.effects, 8, value => { const effect = exact(value, ['path','utf8']); text(effect.path, 1024); text(effect.utf8, 1048576); });
  text(record.stdout, 65536); text(record.stderr, 65536);
  if (record.terminal !== null) { const terminal = control(record.terminal, record.session); if (!['entryReturned','guestFailure'].includes(terminal.kind)) throw Error('terminal role'); }
  list(record.outcomes, 128, value => { const outcome = exact(value, ['seq','kind','finalAck','delivered','closed']); integer(outcome.seq, 1, 128); enumeration(outcome.kind, ['text','void','fsError','denied']); boolean(outcome.finalAck); boolean(outcome.delivered); boolean(outcome.closed); });
  integer(record.reservationPeak, 0, 16777216); if (record.guestJobs !== 'unknown-not-all-settled') throw Error('job qualification'); integer(record.captureBytes, 0, 65536);
  if (record.loadAttestation !== null) { const report = exact(record.loadAttestation, ['v','session','kind','files']); if (report.v !== 3 || report.session !== record.session || report.kind !== 'loadAttestation') throw Error('load role'); list(report.files, 128, value => { const file = exact(value, ['path','bytes','sha256']); text(file.path, 256); integer(file.bytes, 0, 2097152); if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('load digest'); }); }
  if (record.heapEnforcement !== null) { const heap = exact(record.heapEnforcement, ['observedOom','normalLoopExitIsNegative','engineEvaluations']); boolean(heap.observedOom); if (heap.normalLoopExitIsNegative !== true || heap.engineEvaluations !== 0) throw Error('heap-only profile'); }
  return record;
}
export function reasonWitnesses(raw, identities) {
  const known = exact(identities, ['callerReason','sinkReason','cleanupReason']);
  list(raw, 1024, value => { const record = exact(value, ['present','value','provenance']); if (record.present !== true) throw Error('actual reason presence'); enumeration(record.provenance, provenances); });
  return { raw, identities: known };
}
