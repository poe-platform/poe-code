import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { phaseWindow, canAdmitBatch, beginBatchPhase, finishBatchPhase, acceptPhaseMessage } from '../runner/v7/batch-phases.mjs';

const root = new URL('./CONTROLS-01/', import.meta.url);
const started = performance.now();
const rows = [];
let written = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function publish(name, value) {
  if (performance.now() - started > 60000) throw new Error('CONTROL_DEADLINE');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  written += bytes.length;
  if (written > 1048576) throw new Error('CONTROL_CAPTURE_CAP');
  await fs.writeFile(new URL(name, root), bytes, { flag: 'wx', mode: 0o600 });
}
function require(condition, label) { if (!condition) throw new Error(label); }
function rejects(operation, expected) {
  try { operation(); } catch (error) { require(error.message === expected, 'wrong error: ' + error.message); return; }
  throw new Error('expected rejection');
}
async function rejectsAsync(operation, expected) {
  try { await operation(); } catch (error) { require(error.message === expected, 'wrong error: ' + error.message); return; }
  throw new Error('expected rejection');
}
function syntheticState(origin = 0) {
  let now = origin;
  const records = [];
  const messages = [];
  const state = {
    budget: { origin, end: origin + 1000000, now: () => now, deadline: offset => Math.min(1000000, offset), admit: deadline => require(now < deadline, 'ADMISSION_CLOSED'), record: async (label, value) => { records.push({ label, value }); } },
    recipe: { phaseEndsMs: { types: 900000 }, caps: { wallMs: 1000000, finalizeMs: 0 } },
    notifyPhase: async message => { messages.push(message); }
  };
  return { state, records, messages, setNow: value => { now = value; } };
}
const batch = { id: 'T01-M', phase: 'types' };
const protocolRecipe = { batches: [batch], phaseEndsMs: { types: 900000 }, caps: { wallMs: 1000000, finalizeMs: 0 } };
const initial = () => ({ index: 0, next: 'BODY', active: null });
const start = () => ({ role: 'BATCH_PHASE_START', batchId: 'T01-M', kind: 'BODY', startedOffsetMs: 0, deadlineOffsetMs: 30000, capMs: 30000 });
const end = () => ({ role: 'BATCH_PHASE_END', batchId: 'T01-M', kind: 'BODY', endedOffsetMs: 10000, deadlineOffsetMs: 30000, disposition: 'PASS', failure: null });
const cases = [
  ['captured-exact-excess-preserved', () => { const captured = 254479.47441700002; const upper = 134479.474417 + 120000; require(captured - upper === 2.9103830456733704e-11, 'raw excess'); rejects(() => acceptPhaseMessage({ ...start(), kind: 'VERIFY', startedOffsetMs: 134479.474417, deadlineOffsetMs: captured, capMs: 120000 }, { index: 0, next: 'VERIFY', active: null }, protocolRecipe, 134480), 'PHASE_START_BOUND'); }],
  ['captured-relative-deadline-once', () => { const window = phaseWindow(134479.474417, 900000, 1000000, 'VERIFY'); require(window.deadline === 254479.474417, 'authoritative value'); const message = { ...start(), kind: 'VERIFY', startedOffsetMs: window.started, deadlineOffsetMs: window.deadline, capMs: window.cap }; require(acceptPhaseMessage(message, { index: 0, next: 'VERIFY', active: null }, protocolRecipe, 134480).active.deadlineOffsetMs === window.deadline, 'exact admitted binding'); }],
  ['positive-fractional-origin', async () => { const test = syntheticState(0.125); test.setNow(134479.474417 + 0.125); const phase = await beginBatchPhase(test.state, batch, 'VERIFY'); const message = test.messages[0]; require(message.startedOffsetMs === phase.started && message.deadlineOffsetMs === phase.deadline && phase.deadline === phase.started + 120000, 'no translated value'); require(acceptPhaseMessage(message, { index: 0, next: 'VERIFY', active: null }, protocolRecipe, phase.started + 1).active.deadlineOffsetMs === phase.deadline, 'protocol'); test.setNow(0.125 + phase.deadline - 1); const ended = await finishBatchPhase(test.state, 'PASS'); require(ended.deadlineOffsetMs === phase.deadline, 'end identity'); }],
  ['negative-fractional-origin', async () => { const test = syntheticState(-124563.812345); test.setNow(12345.678901); const phase = await beginBatchPhase(test.state, batch, 'BODY'); require(test.messages[0].deadlineOffsetMs === phase.deadline && test.state.batchDeadline === test.state.budget.origin + phase.deadline, 'local timer only'); require(acceptPhaseMessage(test.messages[0], initial(), protocolRecipe, phase.started + 1).active.deadlineOffsetMs === phase.deadline, 'protocol'); }],
  ['fractional-outer-clamp', () => { const window = phaseWindow(134479.474417, 900000, 134500.125, 'VERIFY'); require(window.deadline === 134500.125, 'outer value preserved'); }],
  ['fractional-zero-remaining', () => rejects(() => phaseWindow(134479.474417, 900000, 134479.474417, 'VERIFY'), 'VERIFY_ADMISSION_EXPIRED')],
  ['overflow-window-rejected', () => rejects(() => phaseWindow(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 'BODY'), 'PHASE_WINDOW_ARGUMENT')],
  ['overflow-admission-rejected', () => rejects(() => canAdmitBatch(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0), 'BATCH_WINDOW_ARGUMENT')],
  ['negative-coordinate-rejected', () => rejects(() => phaseWindow(-1, 900000, 1000000, 'BODY'), 'PHASE_WINDOW_ARGUMENT')],
  ['nan-metadata-rejected', () => rejects(() => acceptPhaseMessage({ ...start(), startedOffsetMs: NaN }, initial(), protocolRecipe, 1), 'PHASE_START_VALUES')],
  ['string-metadata-rejected', () => rejects(() => acceptPhaseMessage({ ...start(), deadlineOffsetMs: '30000' }, initial(), protocolRecipe, 1), 'PHASE_START_VALUES')],
  ['overflow-metadata-rejected', () => rejects(() => acceptPhaseMessage({ ...start(), deadlineOffsetMs: Number.MAX_VALUE }, initial(), protocolRecipe, 1), 'PHASE_START_VALUES')],
  ['fractional-genuine-overdeadline', async () => { const test = syntheticState(0.125); test.setNow(100.625); const phase = await beginBatchPhase(test.state, batch, 'VERIFY'); test.setNow(test.state.budget.origin + phase.deadline + 0.25); await rejectsAsync(() => finishBatchPhase(test.state, 'PASS'), 'VERIFY_PHASE_DEADLINE'); require(test.records.at(-1).value.disposition === 'DEADLINE', 'late end captured'); }],
  ['fractional-protocol-late-end', () => { const message = { ...start(), startedOffsetMs: 100.125, deadlineOffsetMs: 30100.125 }; const current = acceptPhaseMessage(message, initial(), protocolRecipe, 101); rejects(() => acceptPhaseMessage({ ...end(), endedOffsetMs: 30100.25, deadlineOffsetMs: 30100.125 }, current, protocolRecipe, 30100.25), 'PHASE_END_DEADLINE'); }],
  ['body-fixed30', () => require(phaseWindow(0, 999999, 999999, 'BODY').deadline === 30000, 'body cap')],
  ['verify-fixed120', () => require(phaseWindow(0, 999999, 999999, 'VERIFY').deadline === 120000, 'verification cap')],
  ['body-outer-clamp', () => require(phaseWindow(0, 999999, 10000, 'BODY').deadline === 10000, 'outer clamp')],
  ['verify-phase-clamp', () => require(phaseWindow(0, 5000, 999999, 'VERIFY').deadline === 5000, 'phase clamp')],
  ['outer-expired', () => rejects(() => phaseWindow(10000, 999999, 10000, 'BODY'), 'BODY_ADMISSION_EXPIRED')],
  ['invalid-kind', () => rejects(() => phaseWindow(0, 999999, 999999, 'OTHER'), 'PHASE_WINDOW_ARGUMENT')],
  ['full-window-exact-fit', () => require(canAdmitBatch(0, 150000, 200000, 0), 'exact fit')],
  ['full-window-no-fit', () => require(!canAdmitBatch(0, 149999, 200000, 0), 'no fit')],
  ['finalization-reserve', () => require(!canAdmitBatch(0, 200000, 200000, 50001), 'reserve')],
  ['body-inclusive-end', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'BODY'); test.setNow(30000); const result = await finishBatchPhase(test.state, 'PASS'); require(result.disposition === 'PASS' && test.state.activeBatchPhase === undefined, 'body end'); }],
  ['body-expired-end', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'BODY'); test.setNow(30001); await rejectsAsync(() => finishBatchPhase(test.state, 'PASS'), 'BODY_PHASE_DEADLINE'); require(test.records.at(-1).value.disposition === 'DEADLINE', 'deadline preserved'); }],
  ['body-failure-distinct', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'BODY'); const result = await finishBatchPhase(test.state, 'FAIL', 'TYPE_DIAGNOSTIC'); require(result.failure === 'TYPE_DIAGNOSTIC' && result.kind === 'BODY', 'body failure'); }],
  ['verification-independent-window', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'BODY'); test.setNow(10000); await finishBatchPhase(test.state, 'PASS'); await beginBatchPhase(test.state, batch, 'VERIFY'); require(test.state.verificationDeadline === 130000, 'new verification only'); test.setNow(90000); require((await finishBatchPhase(test.state, 'PASS')).kind === 'VERIFY', 'verification end'); }],
  ['verification-failure-distinct', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'VERIFY'); const result = await finishBatchPhase(test.state, 'FAIL', 'HASH_MISMATCH'); require(result.failure === 'HASH_MISMATCH' && result.kind === 'VERIFY', 'guard failure'); }],
  ['verification-expired-end', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'VERIFY'); test.setNow(120001); await rejectsAsync(() => finishBatchPhase(test.state, 'PASS'), 'VERIFY_PHASE_DEADLINE'); }],
  ['overlapping-phase-denied', async () => { const test = syntheticState(); await beginBatchPhase(test.state, batch, 'BODY'); await rejectsAsync(() => beginBatchPhase(test.state, batch, 'VERIFY'), 'OVERLAPPING_BATCH_PHASE'); }],
  ['protocol-start-valid', () => require(acceptPhaseMessage(start(), initial(), protocolRecipe, 1).active.deadlineOffsetMs === 30000, 'start')],
  ['protocol-body-overbudget', () => rejects(() => acceptPhaseMessage({ ...start(), deadlineOffsetMs: 30001 }, initial(), protocolRecipe, 1), 'PHASE_START_BOUND')],
  ['protocol-extra-field', () => rejects(() => acceptPhaseMessage({ ...start(), extra: true }, initial(), protocolRecipe, 1), 'PHASE_START_KEYS')],
  ['protocol-wrong-batch', () => rejects(() => acceptPhaseMessage({ ...start(), batchId: 'OTHER' }, initial(), protocolRecipe, 1), 'PHASE_BATCH_ORDER')],
  ['protocol-verify-before-body', () => rejects(() => acceptPhaseMessage({ ...start(), kind: 'VERIFY', capMs: 120000 }, initial(), protocolRecipe, 1), 'PHASE_START_ORDER')],
  ['protocol-end-late', () => { const current = acceptPhaseMessage(start(), initial(), protocolRecipe, 1); rejects(() => acceptPhaseMessage(end(), current, protocolRecipe, 30001), 'PHASE_END_DEADLINE'); }],
  ['protocol-full-sequence', () => { let current = acceptPhaseMessage(start(), initial(), protocolRecipe, 1); current = acceptPhaseMessage(end(), current, protocolRecipe, 10000); current = acceptPhaseMessage({ ...start(), kind: 'VERIFY', startedOffsetMs: 10000, deadlineOffsetMs: 130000, capMs: 120000 }, current, protocolRecipe, 10001); current = acceptPhaseMessage({ ...end(), kind: 'VERIFY', endedOffsetMs: 11000, deadlineOffsetMs: 130000, disposition: 'FAIL', failure: 'HASH_MISMATCH' }, current, protocolRecipe, 11000); require(current.index === 1 && current.active === null, 'sequence'); }],
  ['protocol-overall-expiry', () => rejects(() => acceptPhaseMessage(start(), initial(), { ...protocolRecipe, caps: { wallMs: 10000, finalizeMs: 0 } }, 1), 'PHASE_START_BOUND')]
];
await fs.mkdir(root, { mode: 0o700 });
await publish('STARTUP.json', { role: 'SYNTHETIC_REVIEW_CODE_ONLY', cases: cases.length, productLoads: 0, compilerLoads: 0, children: 0 });
const sourceBytes = await fs.readFile(new URL('../runner/v7/batch-phases.mjs', import.meta.url));
for (const [id, run] of cases) {
  let failure = null;
  try { await run(); } catch (error) { failure = error.message; }
  rows.push({ id, passed: failure === null, failure });
  await publish(String(rows.length).padStart(2, '0') + '.json', rows.at(-1));
}
await publish('RESULT.json', { role: 'SYNTHETIC_NOT_PRODUCT_OR_REAL_WATCHDOG_PROOF', phaseSourceSha256: hash(sourceBytes), pass: rows.filter(row => row.passed).length, fail: rows.filter(row => !row.passed).length, rows, elapsedMs: performance.now() - started, captureBytesBeforeResult: written, children: 0, activeOwnedChildren: 0 });
process.exitCode = rows.every(row => row.passed) ? 0 : 1;
