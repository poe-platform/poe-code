import { atomicJson, keys, milliseconds, minimum, now, readBoundJson, requireFact } from './primitives.mjs';
import { join } from 'node:path';

const [bootPath, bootHash] = process.argv.slice(2);
const boot = readBoundJson(bootPath, bootHash);
let sequence = 0;
let responseSequence = 0;
let pending = null;
process.on('message', message => {
  try {
    keys(message, ['schema', 'nonce', 'seq', 'type', 'payload']);
    requireFact(message.schema === 1 && message.nonce === boot.nonce && message.seq === responseSequence++ && message.type === 'REPLY' && pending, 'COORDINATOR_REPLY');
    const current = pending;
    pending = null;
    if (message.payload.error) current.reject(Object.assign(new Error(message.payload.error.message), message.payload.error));
    else current.resolve(message.payload.value);
  } catch (error) { pending?.reject(error); pending = null; process.exitCode = 1; process.disconnect(); }
});
const rpc = (type, payload) => new Promise((resolve, reject) => {
  requireFact(pending === null, 'ONE_OUTER_IN_FLIGHT');
  pending = { resolve, reject };
  process.send({ schema: 1, nonce: boot.nonce, seq: sequence++, type, payload }, error => { if (error) { pending = null; reject(error); } });
});
const results = [];
let sticky = false;
let stopped = false;
let currentPhase = null;
let phaseDeadline = null;
try {
  for (const job of boot.jobs) {
    let firstReservation = null;
    if (job.phase !== currentPhase) {
      const phase = boot.phases.find(entry => entry.id === job.phase);
      requireFact(phase, 'UNKNOWN_PHASE');
      currentPhase = job.phase;
      firstReservation = job.phase === 'AUTHENTICATION' ? BigInt(boot.originNs) : now();
      phaseDeadline = minimum(BigInt(boot.globalDeadlineNs), BigInt(boot.originNs) + milliseconds(phase.absoluteCutoffOffsetMs), firstReservation + milliseconds(phase.capMs));
    }
    const reserved = firstReservation ?? now();
    const deadline = minimum(phaseDeadline, BigInt(boot.globalDeadlineNs), reserved + milliseconds(job.slotCapMs));
    if (stopped || reserved + milliseconds(job.slotCapMs) > phaseDeadline) {
      const reason = stopped ? 'STOP_UNSAFE_PRIOR' : 'UNRUN_REMAINING_ABSOLUTE_BUDGET';
      results.push(await rpc('UNRUN', { id: job.id, reason }));
      sticky = true;
      continue;
    }
    const result = await rpc('RUN', { id: job.id, reservationNs: reserved.toString(), phaseDeadlineNs: phaseDeadline.toString(), jobDeadlineNs: deadline.toString() });
    results.push(result);
    if (result.aggregateFailure || result.status !== 'PASS') sticky = true;
    if (result.unsafe || !result.integrity || !result.reaped) stopped = true;
  }
  requireFact(results.length === 336 && new Set(results.map(result => result.jobId)).size === 336, 'COMPLETE_RECEIPT_COHORT');
  const summary = { schema: 1, status: sticky ? 'FAIL' : 'PASS_ROLE_PROJECTIONS_ONLY', candidate: boot.candidate, outerSlots: 336, jobs: results, semanticFullRecordPasses: null, missingRecords: 80, missingBindings: 135, environments: ['source-built-direct', 'installed-moved-direct'], noFull194Acceptance: true };
  atomicJson(join(boot.evidenceRoot, 'coordinator-summary.json'), summary);
  await rpc('FINAL', { status: summary.status, count: results.length });
  if (sticky) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  try { await rpc('COORDINATOR_FATAL', { message: String(error), unsafe: true }); } catch {}
} finally { if (process.connected) process.disconnect(); }
