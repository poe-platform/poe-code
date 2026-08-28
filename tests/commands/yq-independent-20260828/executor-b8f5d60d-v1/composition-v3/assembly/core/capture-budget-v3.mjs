import { join } from 'node:path';
import { atomicBytes, requireFact, sha256 } from './primitives.mjs';

export const JOB_CAPTURE_BYTES = 33554432;
export const PHASE_CAPTURE_BYTES = 4194304;
export const PROCESS_RECEIPT_BYTES = 131072;
const FILE_BYTES = 16777216;
const TERMINAL_BYTES = { outerProcess: 131072, jobReceipt: 262144, integrityFailure: 131072, outerOutcome: 262144, accounting: 65536, captureFailure: 65536, phaseFailure: 16384 };

export function createJobCaptureBudget(root) {
  const terminalReserved = Object.values(TERMINAL_BYTES).reduce((sum, bytes) => sum + bytes, 0);
  const ordinaryInitial = JOB_CAPTURE_BYTES - PHASE_CAPTURE_BYTES - terminalReserved;
  return { root, limit: JOB_CAPTURE_BYTES, ordinaryInitial, remaining: ordinaryInitial, phaseUsed: 0, terminalReserved, terminals: Object.fromEntries(Object.entries(TERMINAL_BYTES).map(([name, capacity]) => [name, { capacity, remaining: capacity, used: 0, extra: 0, taken: false }])), heldProcesses: 0, overflow: false, firstFailure: null };
}

export function markCaptureOverflow(budget, reason, attemptedBytes, availableBytes) {
  budget.overflow = true;
  budget.firstFailure ??= { schema: 1, status: 'FAIL', reason, attemptedBytes, availableBytes, rawPrefixRetained: true, sourceBugInferred: false };
  if (budget.terminals && !budget.terminals.captureFailure.taken) terminalJson(budget, 'captureFailure', join(budget.root, 'capture-overflow.json'), budget.firstFailure);
}

export function chargeCapture(budget, bytes) {
  requireFact(Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(budget.remaining) && budget.remaining >= 0, 'CAPTURE_CHARGE_TYPE');
  if (bytes > budget.remaining) {
    markCaptureOverflow(budget, 'JOB_CAPTURE_BUDGET', bytes, budget.remaining);
    requireFact(false, 'JOB_CAPTURE_BUDGET');
  }
  budget.remaining -= bytes;
}

export function chargePhase(budget, bytes) {
  requireFact(Number.isSafeInteger(bytes) && bytes >= 0, 'PHASE_CHARGE_TYPE');
  if (budget.phaseUsed + bytes > PHASE_CAPTURE_BYTES) {
    markCaptureOverflow(budget, 'PHASE_CAPTURE_BUDGET', bytes, PHASE_CAPTURE_BYTES - budget.phaseUsed);
    requireFact(false, 'PHASE_CAPTURE_BUDGET');
  }
  budget.phaseUsed += bytes;
}

export function captureJson(budget, filename, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > FILE_BYTES) {
    markCaptureOverflow(budget, 'CAPTURE_FILE_BUDGET', bytes.length, FILE_BYTES);
    requireFact(false, 'CAPTURE_FILE_BUDGET');
  }
  chargeCapture(budget, bytes.length);
  return atomicBytes(filename, bytes);
}

function claimTerminal(budget, name) {
  const slot = budget.terminals?.[name];
  requireFact(slot && !slot.taken, 'TERMINAL_CAPTURE_SLOT');
  slot.taken = true;
  return { budget, slot, pool: 'terminal', closed: false };
}

export function reserveProcessReceipt(budget, role) {
  if (role === 'outer') return claimTerminal(budget, 'outerProcess');
  chargeCapture(budget, PROCESS_RECEIPT_BYTES);
  budget.heldProcesses = (budget.heldProcesses ?? 0) + 1;
  return { budget, slot: { capacity: PROCESS_RECEIPT_BYTES, remaining: PROCESS_RECEIPT_BYTES, used: 0, extra: 0 }, pool: 'ordinary', closed: false };
}

export function publishReservedJson(reservation, filename, value) {
  requireFact(!reservation.closed && reservation.slot.used === 0, 'CAPTURE_RESERVATION_USED');
  const { budget, slot } = reservation;
  const original = Buffer.from(`${JSON.stringify(value)}\n`);
  const extra = Math.max(0, original.length - slot.remaining);
  let bytes = original;
  let complete = true;
  if (original.length > FILE_BYTES || extra > budget.remaining) {
    markCaptureOverflow(budget, 'CAPTURE_METADATA_OVERFLOW', original.length, Math.min(FILE_BYTES, slot.remaining + budget.remaining));
    bytes = Buffer.from(`${JSON.stringify({ schema: 1, status: 'FAIL', reason: 'CAPTURE_METADATA_OVERFLOW', originalBytes: original.length, originalSha256: sha256(original), boundedPrefixHex: original.subarray(0, 1024).toString('hex'), completeMetadata: false, rawProcessPrefixesRetained: true })}\n`);
    complete = false;
  } else if (extra) {
    chargeCapture(budget, extra);
    slot.extra += extra;
    slot.remaining += extra;
  }
  requireFact(bytes.length <= slot.remaining, 'TERMINAL_FALLBACK_BOUND');
  slot.remaining -= bytes.length;
  slot.used += bytes.length;
  const artifact = atomicBytes(filename, bytes);
  return { artifact, complete };
}

export function releaseProcessReceipt(reservation) {
  requireFact(!reservation.closed, 'CAPTURE_RESERVATION_CLOSED');
  reservation.closed = true;
  if (reservation.pool === 'ordinary') {
    reservation.budget.remaining += reservation.slot.remaining;
    reservation.budget.heldProcesses--;
    reservation.slot.remaining = 0;
  }
}

export function terminalJson(budget, name, filename, value) {
  const reservation = claimTerminal(budget, name);
  try { return publishReservedJson(reservation, filename, value); }
  finally { releaseProcessReceipt(reservation); }
}

export function captureAccounting(budget, manifest) {
  const actualBytes = Object.values(manifest.files).reduce((sum, entry) => sum + entry.bytes, 0);
  const ordinaryCharged = budget.ordinaryInitial - budget.remaining;
  const terminalUsed = Object.fromEntries(Object.entries(budget.terminals).map(([name, slot]) => [name, { reserved: slot.capacity, actualCharge: slot.used, ordinarySupplement: slot.extra }]));
  const terminalBaseUsed = Object.values(budget.terminals).reduce((sum, slot) => sum + Math.min(slot.used, slot.capacity), 0);
  const accountedBytes = ordinaryCharged + budget.phaseUsed + terminalBaseUsed;
  requireFact(budget.heldProcesses === 0, 'CAPTURE_RESERVATION_STILL_ACTIVE');
  requireFact(Number.isSafeInteger(actualBytes) && actualBytes <= JOB_CAPTURE_BYTES, 'JOB_ACTUAL_CAPTURE_LIMIT');
  requireFact(actualBytes <= accountedBytes, 'JOB_UNCHARGED_EVIDENCE');
  return { cap: JOB_CAPTURE_BYTES, actualBytes, accountedBytes, ordinaryCharged, ordinaryRemaining: budget.remaining, phaseReserved: PHASE_CAPTURE_BYTES, phaseCharged: budget.phaseUsed, terminalReserved: budget.terminalReserved, terminalUsed, everyEvidenceFileCounted: true, duplicateContentCountedPerFile: true, overflow: budget.overflow, firstFailure: budget.firstFailure, physicalQuotaGuarantee: false };
}
