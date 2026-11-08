import { receiptSchema, reasonWitnesses } from './receipt-schema.mjs';
export function judgeCase(row, value, raw, identities) {
  const failures = [];
  const check = (condition, label) => { if (!condition) failures.push(label); };
  let receipt; let witness;
  try { receipt = receiptSchema(value); witness = reasonWitnesses(raw, identities); } catch { return { case: row.instance, qualified: false, failures: ['exact finite own-data schema'], clean: false }; }
  check(receipt.case === row.instance, 'case identity');
  check(receipt.raw.length === witness.raw.length, 'raw cardinality');
  for (let index = 0; index < receipt.raw.length; index += 1) {
    const summary = receipt.raw[index]; const actual = witness.raw[index];
    check(Boolean(actual) && actual.provenance === summary.provenance && actual.present === summary.present && summary.callerIdentity === (actual.value === witness.identities.callerReason) && summary.sinkIdentity === (actual.value === witness.identities.sinkReason) && summary.cleanupIdentity === (actual.value === witness.identities.cleanupReason), 'raw reference/provenance binding');
  }
  const facts = receipt.facts;
  check(facts.acquisition === 'acquired' && facts.exited && facts.exitCode !== null && !facts.admission, 'actual acquisition/exit/cutoff');
  check(facts.cleanupSettled && facts.cleanupClosed === (row.fixture !== 'L06b'), 'cleanup success vs intentional failure');
  check(receipt.privateFailures === 0, 'no hidden private failure');
  check(receipt.status === row.expectedStatus && receipt.rawOutcomeRequiresActualHostMapping === (receipt.raw.length > 0), 'exact status/mapping');
  check(receipt.stdout === row.expectedStdout && receipt.stderr === row.expectedStderr && receipt.captureBytes === 0, 'exact channels');
  const expected = new Map([['/data/input.json','{"count":1}'],['/data/object.json','{"count":1}'],...Object.entries(row.expectedEffects)]);
  check(receipt.effects.length === expected.size && new Set(receipt.effects.map(effect => effect.path)).size === expected.size && receipt.effects.every(effect => expected.get(effect.path) === effect.utf8), 'exact final VFS');
  const positions = kind => receipt.events.flatMap((event,index) => event.kind === kind ? [index] : []);
  check(positions('worker-exit').length === 1 && positions('parent-cleanup-closed').length === 1 && positions('worker-exit')[0] < positions('parent-cleanup-closed')[0], 'exit then settled parent cleanup');
  check(positions('cutoff').length === 1 && positions('termination-requested').length === 1, 'single cutoff/termination');
  check(positions('ready').length === (row.fixture === 'L08' ? 0 : 1), 'exact READY');
  if (row.fixture !== 'L08') check(positions('ready')[0] < positions('cutoff')[0], 'READY before cutoff');
  const outcomes = receipt.outcomes;
  check(new Set(outcomes.map(outcome => outcome.seq)).size === outcomes.length && outcomes.every((outcome,index) => outcome.seq === index + 1), 'ordered unique outcome sequences');
  for (const outcome of outcomes) {
    check(!outcome.delivered || outcome.finalAck && outcome.closed, 'delivery requires final ACK and cleanup');
    const ack = receipt.events.findIndex(event => event.kind === 'final-ack-not-delivery' && event.seq === outcome.seq);
    const delivered = receipt.events.findIndex(event => event.kind === 'postcopy-marker-received' && event.seq === outcome.seq);
    check((ack >= 0) === outcome.finalAck && (delivered >= 0) === outcome.delivered && (!outcome.delivered || delivered > ack), 'outcome/event binding');
    check(receipt.events.filter(event => event.kind === 'final-ack-not-delivery' && event.seq === outcome.seq).length <= 1 && receipt.events.filter(event => event.kind === 'postcopy-marker-received' && event.seq === outcome.seq).length <= 1, 'no duplicate delivery');
    check(outcome.kind !== 'fsError' || outcome.delivered, 'undelivered typed failure not silently successful');
  }
  if (receipt.terminal !== null) check(receipt.terminal.lastSeq === outcomes.length && receipt.terminal.deliveredSeq === outcomes.filter(outcome => outcome.delivered).length && outcomes.every(outcome => outcome.closed && outcome.finalAck), 'terminal reconciliation');
  check(receipt.events.filter(event => event.kind === 'output-published').reduce((sum,event) => sum + event.bytes, 0) === Buffer.byteLength(receipt.stdout), 'published output byte reconciliation');
  check(receipt.events.filter(event => event.kind === 'file-effect').length === Object.keys(row.expectedEffects).length && receipt.events.filter(event => event.kind === 'file-effect').reduce((sum,event) => sum + event.bytes, 0) === Object.values(row.expectedEffects).reduce((sum,value) => sum + Buffer.byteLength(value), 0), 'published file effects');
  for (const event of receipt.events.filter(event => ['final-ack-not-delivery','postcopy-marker-received'].includes(event.kind))) check(outcomes.some(outcome => outcome.seq === event.seq), 'no orphan outcome event');
  check(row.fixture === 'L08' ? receipt.loadAttestation === null : receipt.loadAttestation !== null, 'actual load report role');
  const normal = !['L05','L06a','L06b','L08'].includes(row.fixture);
  if (normal) { check(receipt.raw.length === 0 && receipt.terminal?.kind === 'entryReturned' && outcomes.every(outcome => outcome.delivered), 'normal terminal and no escaping reason'); check(facts.exitCode === 0 || facts.exitCode === 1 && positions('termination-requested')[0] < positions('worker-exit')[0], 'confirmed natural or requested lifetime retirement'); }
  if (row.fixture === 'L05' || row.fixture === 'L06a') { check(receipt.raw.some(reason => reason.provenance === 'caller' && reason.callerIdentity), 'caller exact reason including falsy'); check(receipt.raw.every(reason => ['caller','late-parent-secondary'].includes(reason.provenance)), 'caller route secondary scope'); }
  if (row.fixture === 'L06b') { check(receipt.raw.length === 2 && receipt.raw[0].provenance === 'escaping-parent' && receipt.raw[0].sinkIdentity && receipt.raw[1].provenance === 'cleanup' && receipt.raw[1].cleanupIdentity, 'sink primary then cleanup secondary'); }
  if (row.fixture === 'L08') { check(receipt.heapEnforcement?.observedOom === true && facts.exitCode !== 0 && receipt.terminal === null && outcomes.length === 0 && receipt.raw.length === 1 && receipt.raw[0].provenance === 'worker-control', 'actual OOM/exit; normal heap completion negative'); }
  else check(receipt.heapEnforcement === null, 'not heap-only branch');
  return { case: row.instance, qualified: failures.length === 0, failures, clean: failures.length === 0 && facts.cleanupClosed };
}
