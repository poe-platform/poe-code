import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { phaseWindow, canAdmitBatch, beginBatchPhase, finishBatchPhase, acceptPhaseMessage } from '../runner/v6/batch-phases.mjs';

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
function syntheticState() {
  let now = 0;
  const records = [];
  const messages = [];
  const state = {
    budget: { origin: 0, end: 1000000, now: () => now, deadline: offset => Math.min(1000000, offset), admit: deadline => require(now < deadline, 'ADMISSION_CLOSED'), record: async (label, value) => { records.push({ label, value }); } },
    recipe: { phaseEndsMs: { types: 900000 }, caps: { finalizeMs: 0 } },
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
const sourceBytes = await fs.readFile(new URL('../runner/v6/batch-phases.mjs', import.meta.url));
for (const [id, run] of cases) {
  let failure = null;
  try { await run(); } catch (error) { failure = error.message; }
  rows.push({ id, passed: failure === null, failure });
  await publish(String(rows.length).padStart(2, '0') + '.json', rows.at(-1));
}
await publish('RESULT.json', { role: 'SYNTHETIC_NOT_PRODUCT_OR_REAL_WATCHDOG_PROOF', phaseSourceSha256: hash(sourceBytes), pass: rows.filter(row => row.passed).length, fail: rows.filter(row => !row.passed).length, rows, elapsedMs: performance.now() - started, captureBytesBeforeResult: written, children: 0, activeOwnedChildren: 0 });
process.exitCode = rows.every(row => row.passed) ? 0 : 1;
