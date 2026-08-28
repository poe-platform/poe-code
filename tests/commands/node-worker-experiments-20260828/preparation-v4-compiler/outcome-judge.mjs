export function judgeCase(row, receipt) {
  let nodes = 0;
  function ownData(value) {
    if (++nodes > 8192) throw Error('receipt finite node bound');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value === 'string' && value.length <= 1048576) return;
    if (typeof value !== 'object') throw Error('receipt own-data type');
    const keys = Reflect.ownKeys(value); if (keys.length > 2048 || keys.some(key => typeof key !== 'string')) throw Error('receipt keys');
    if (Array.isArray(value) && (keys.length !== value.length + 1 || Array.from({length:value.length}, (_, index) => String(index)).some(key => !Object.hasOwn(value, key)))) throw Error('receipt holes/extras');
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!Object.hasOwn(descriptor, 'value')) throw Error('receipt accessor'); ownData(descriptor.value); }
  }
  try { ownData(receipt); } catch { return { case: row.instance, qualified: false, failures: ['finite own-data receipt'] }; }
  const failures = [];
  const check = (condition, label) => { if (!condition) failures.push(label); };
  check(receipt.case === row.instance, 'case identity');
  check(receipt.facts.acquisition === 'acquired' && receipt.facts.exited === true, 'actual Worker acquired/exited');
  check(receipt.facts.cleanupSettled === true, 'cleanup settled');
  check(receipt.facts.cleanupClosed === (row.fixture !== 'L06b'), 'cleanup success vs intentional rejection');
  check(receipt.status === row.expectedStatus, 'exact status');
  check(receipt.stdout === row.expectedStdout && receipt.stderr === row.expectedStderr, 'exact channels');
  check(receipt.captureBytes === 0 && receipt.reservationPeak <= 16777216, 'capture/ledger');
  const expected = new Map([['/data/input.json', '{"count":1}'], ['/data/object.json', '{"count":1}'], ...Object.entries(row.expectedEffects)]);
  check(receipt.effects.length === expected.size && new Set(receipt.effects.map(item => item.path)).size === expected.size && receipt.effects.every(item => expected.get(item.path) === item.utf8), 'exact final VFS including unchanged files');
  const raw = receipt.raw;
  if (row.fixture === 'L08') { check(receipt.heapEnforcement?.observedOom === true && receipt.heapEnforcement.engineEvaluations === 0 && receipt.facts.exitCode !== 0, 'L08 actual OOM and nonzero exit; normal completion is failure'); check(raw.some(item => item.provenance === 'worker-control'), 'L08 control reason'); }
  else { check(receipt.events.filter(item => item.kind === 'ready').length === 1, 'exact READY'); }
  if (row.fixture === 'L05' || row.fixture === 'L06a') check(raw.some(item => item.provenance === 'caller' && item.present === true && item.callerIdentity === true), 'raw caller identity including falsy');
  else if (row.fixture === 'L06b') { check(raw.some(item => item.provenance === 'escaping-parent' && item.sinkIdentity === true), 'sink identity'); check(raw.some(item => item.provenance === 'cleanup' && item.cleanupIdentity === true), 'cleanup identity'); }
  else if (row.fixture !== 'L08') { check(raw.length === 0 && receipt.terminal?.kind === 'entryReturned' && receipt.facts.exitCode === 0, 'normal terminal and no raw failure'); check(receipt.outcomes.every(item => item.closed && item.finalAck && item.delivered), 'complete successful operation retirement'); }
  return { case: row.instance, qualified: failures.length === 0, failures, proof: 'source-prepared judge; no Worker execution', rawReasonIdentity: 'receipt records parent reference comparisons; no JSON equality provenance' };
}
