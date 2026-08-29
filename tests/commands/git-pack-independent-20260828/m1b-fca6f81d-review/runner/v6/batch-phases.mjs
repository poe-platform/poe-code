export const BODY_MS = 30000;
export const VERIFICATION_MS = 120000;

function demand(condition, label) { if (!condition) throw new Error(label); }
export function phaseWindow(now, phaseEnd, overallEnd, kind) {
  demand([now, phaseEnd, overallEnd].every(Number.isFinite) && ['BODY', 'VERIFY'].includes(kind), 'PHASE_WINDOW_ARGUMENT');
  const cap = kind === 'BODY' ? BODY_MS : VERIFICATION_MS;
  const deadline = Math.min(now + cap, phaseEnd, overallEnd);
  demand(now < deadline, kind + '_ADMISSION_EXPIRED');
  return { started: now, deadline, cap };
}
export function canAdmitBatch(now, phaseEnd, overallEnd, finalizationReserve) {
  demand([now, phaseEnd, overallEnd, finalizationReserve].every(Number.isFinite) && finalizationReserve >= 0, 'BATCH_WINDOW_ARGUMENT');
  return now + BODY_MS + VERIFICATION_MS <= Math.min(phaseEnd, overallEnd - finalizationReserve);
}
export async function beginBatchPhase(state, batch, kind) {
  const { budget, recipe } = state;
  demand(state.activeBatchPhase === undefined, 'OVERLAPPING_BATCH_PHASE');
  const window = phaseWindow(budget.now(), budget.deadline(recipe.phaseEndsMs[batch.phase]), budget.end - recipe.caps.finalizeMs, kind);
  budget.admit(window.deadline);
  const phase = { batchId: batch.id, kind, ...window };
  state.activeBatchPhase = phase;
  if (kind === 'BODY') state.batchDeadline = phase.deadline;
  else state.verificationDeadline = phase.deadline;
  const record = { role: 'BATCH_PHASE_START', batchId: batch.id, kind, startedOffsetMs: phase.started - budget.origin, deadlineOffsetMs: phase.deadline - budget.origin, capMs: phase.cap };
  await budget.record('batch-phase-start', record);
  await state.notifyPhase(record);
  demand(budget.now() < phase.deadline, kind + '_START_PUBLICATION_DEADLINE');
  return phase;
}
export async function finishBatchPhase(state, disposition, failure = null) {
  const phase = state.activeBatchPhase;
  demand(phase && ['PASS', 'FAIL', 'UNRUN'].includes(disposition), 'BATCH_PHASE_FINISH');
  const { budget } = state;
  const ended = budget.now();
  const expired = ended > phase.deadline;
  const record = { role: 'BATCH_PHASE_END', batchId: phase.batchId, kind: phase.kind, endedOffsetMs: ended - budget.origin, deadlineOffsetMs: phase.deadline - budget.origin, disposition: expired ? 'DEADLINE' : disposition, failure };
  await budget.record('batch-phase-end', record, disposition !== 'PASS' || expired);
  await state.notifyPhase(record);
  state.activeBatchPhase = undefined;
  demand(!expired && budget.now() <= phase.deadline, phase.kind + '_PHASE_DEADLINE');
  return record;
}

export function acceptPhaseMessage(message, current, recipe, nowOffsetMs) {
  demand(message && typeof message === 'object' && Number.isFinite(nowOffsetMs), 'PHASE_MESSAGE');
  const batch = recipe.batches[current.index];
  demand(batch && message.batchId === batch.id, 'PHASE_BATCH_ORDER');
  const phaseLimit = Math.min(recipe.phaseEndsMs[batch.phase], recipe.caps.wallMs - recipe.caps.finalizeMs);
  if (message.role === 'BATCH_PHASE_START') {
    demand(JSON.stringify(Object.keys(message)) === JSON.stringify(['role', 'batchId', 'kind', 'startedOffsetMs', 'deadlineOffsetMs', 'capMs']), 'PHASE_START_KEYS');
    demand(current.active === null && message.kind === current.next, 'PHASE_START_ORDER');
    const cap = message.kind === 'BODY' ? BODY_MS : VERIFICATION_MS;
    demand(message.capMs === cap && [message.startedOffsetMs, message.deadlineOffsetMs].every(Number.isFinite), 'PHASE_START_VALUES');
    demand(message.startedOffsetMs >= 0 && message.startedOffsetMs <= nowOffsetMs && nowOffsetMs < message.deadlineOffsetMs && message.deadlineOffsetMs <= Math.min(message.startedOffsetMs + cap, phaseLimit), 'PHASE_START_BOUND');
    return { index: current.index, next: current.next, active: { batchId: batch.id, kind: message.kind, deadlineOffsetMs: message.deadlineOffsetMs } };
  }
  demand(message.role === 'BATCH_PHASE_END' && JSON.stringify(Object.keys(message)) === JSON.stringify(['role', 'batchId', 'kind', 'endedOffsetMs', 'deadlineOffsetMs', 'disposition', 'failure']), 'PHASE_END_KEYS');
  demand(current.active?.kind === message.kind && current.active.batchId === batch.id && message.deadlineOffsetMs === current.active.deadlineOffsetMs, 'PHASE_END_BINDING');
  demand(Number.isFinite(message.endedOffsetMs) && message.endedOffsetMs >= 0 && message.endedOffsetMs <= nowOffsetMs && ['PASS', 'FAIL', 'UNRUN', 'DEADLINE'].includes(message.disposition) && (message.failure === null || typeof message.failure === 'string'), 'PHASE_END_VALUES');
  demand(message.disposition !== 'PASS' || message.endedOffsetMs <= message.deadlineOffsetMs && nowOffsetMs <= message.deadlineOffsetMs, 'PHASE_END_DEADLINE');
  return message.kind === 'BODY' ? { index: current.index, next: 'VERIFY', active: null } : { index: current.index + 1, next: 'BODY', active: null };
}
