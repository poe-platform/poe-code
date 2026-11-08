import assert from 'node:assert/strict';

export const IDS = Object.freeze(['R01', 'R02', 'R05', 'R06', 'R07', 'R11', 'R12', 'R22']);
export function record(value, keys) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(descriptors).sort(), [...keys].sort());
  for (const key of keys) assert(Object.hasOwn(descriptors[key], 'value'));
  return value;
}
export function ledger() {
  const state = { present: false, reason: undefined, phase: undefined, secondary: [], omitted: 0 };
  return { state, add(reason, phase) { if (!state.present) Object.assign(state, { present: true, reason, phase }); else if (state.secondary.length < 32) state.secondary.push({ reason, phase }); else state.omitted++; } };
}
export function describe(reason) {
  if (reason === undefined) return { type: 'undefined' };
  if (reason === null) return { type: 'null' };
  if (['boolean', 'number', 'string'].includes(typeof reason)) return { type: typeof reason, value: typeof reason === 'string' ? reason.slice(0, 512) : reason };
  return { type: typeof reason, opaque: true };
}
export function describeLedger(state) {
  return { present: state.present, primary: state.present ? { phase: state.phase, reason: describe(state.reason) } : null, secondary: state.secondary.map(row => ({ phase: row.phase, reason: describe(row.reason) })), omitted: state.omitted };
}
export function captureBudget(maximum) {
  assert(Number.isSafeInteger(maximum) && maximum > 0);
  let admitted = 0;
  return Object.freeze({ reserve(size) { assert(Number.isSafeInteger(size) && size >= 0 && size <= maximum - admitted, 'capture prewrite cap'); admitted += size; }, snapshot() { return { admitted, maximum }; } });
}
export function writer({ write, maximum, aggregate }) {
  const budget = captureBudget(maximum);
  let written = 0;
  return Object.freeze({
    bytes(bytes) {
      assert(Buffer.isBuffer(bytes)); budget.reserve(bytes.length); aggregate.reserve(bytes.length);
      let offset = 0;
      while (offset < bytes.length) { const count = write(bytes, offset, bytes.length - offset); assert(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset); offset += count; written += count; }
    },
    snapshot() { return { ...budget.snapshot(), written }; },
  });
}
export function clock(started, now) {
  assert(Number.isSafeInteger(started) && started >= 0);
  const deadline = started + 1200000;
  let last = started;
  let stopped = false;
  const sample = () => { const current = now(); assert(Number.isSafeInteger(current) && current >= last); last = current; return current; };
  return Object.freeze({ deadline, sample, stop() { stopped = true; }, admit(duration, cleanup = 3000) { assert(Number.isSafeInteger(duration) && duration > 0 && Number.isSafeInteger(cleanup) && cleanup > 0); return !stopped && duration + cleanup + 180000 <= deadline - sample(); }, beforeEnd() { assert(sample() <= deadline, 'whole invocation deadline'); } });
}
export function validateSelection(cells) {
  assert.equal(cells.length, 24);
  const expected = ['source-built', 'installed', 'moved'].flatMap(layout => IDS.map(id => `${layout}/${id}`));
  assert.deepEqual(cells.map(cell => cell.id), expected);
  for (const cell of cells) { assert.equal(cell.definition.route, 'script'); assert.equal(cell.definition.workerStartsMaximum, 1); assert.equal(cell.definition.expected.stderr.exact, ''); assert.equal(cell.shellExecCalls, 1); }
  assert.equal(cells.reduce((sum, cell) => sum + cell.regexVisits, 0), 30);
}
export function validateGrant(grant, profileSha256, started, wallNow) {
  record(grant, ['schema', 'authorized', 'profileSha256', 'sourceReview', 'producerReview', 'pilotReview', 'issuedAt', 'latestStart', 'expiresAt', 'outerStarted', 'sampledNpmWork', 'knownOS', 'peak', 'workers', 'milliseconds', 'publicationMilliseconds', 'captureBytes', 'workingBytes']);
  assert.equal(grant.schema, 1); assert.equal(grant.authorized, true);
  assert.equal(grant.profileSha256, profileSha256);
  assert.equal(grant.sourceReview, 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf');
  assert.equal(grant.producerReview, '5c2ef0795ca402344b5b0d28869b64db46d73b86');
  assert(typeof grant.pilotReview === 'string' && /^[0-9a-f]{40}$/.test(grant.pilotReview));
  assert.equal(grant.outerStarted, started);
  assert.equal(grant.sampledNpmWork, true);
  for (const [key, value] of Object.entries({ knownOS: 40, peak: 4, workers: 24, milliseconds: 1200000, publicationMilliseconds: 180000, captureBytes: 67108864, workingBytes: 268435456 })) assert.equal(grant[key], value);
  const times = ['issuedAt', 'latestStart', 'expiresAt'].map(key => { assert(typeof grant[key] === 'string'); const value = Date.parse(grant[key]); assert(Number.isSafeInteger(value)); return value; });
  assert(times[0] <= wallNow && wallNow <= times[1] && times[1] < times[2]);
  assert(times[2] - times[0] <= 1200000 && wallNow < times[2]);
}
export function judgeCell(cell, receipt, rows) {
  assert.equal(receipt.retired, true, 'native process ownership incomplete');
  assert.equal(receipt.failure.present, false);
  assert.equal(receipt.code, 0); assert.equal(receipt.signal, null);
  assert(rows.length >= 2 && rows.length <= 128);
  const startup = rows.filter(row => row.event === 'startup');
  const finals = rows.filter(row => row.event === 'final');
  assert.equal(startup.length, 1); assert.equal(finals.length, 1);
  assert.equal(rows[0], startup[0]); assert.equal(rows.at(-1), finals[0]);
  assert.equal(startup[0].pid, receipt.pid);
  const final = record(finals[0], ['event', 'id', 'result', 'workers', 'failure']);
  assert.equal(final.id, cell.id);
  record(final.failure, ['present', 'primary', 'secondary', 'omitted']);
  assert.equal(final.failure.present, false); assert.equal(final.failure.primary, null); assert.deepEqual(final.failure.secondary, []);
  assert.equal(final.failure.omitted, 0);
  record(final.result, ['exitCode', 'stdout', 'stderr']);
  assert.equal(final.result.exitCode, cell.definition.expected.exitCode);
  assert.equal(final.result.stdout, cell.definition.expected.stdout);
  assert.equal(final.result.stderr, cell.definition.expected.stderr.exact);
  assert(Array.isArray(final.workers) && final.workers.length <= 1);
  for (const worker of final.workers) {
    record(worker, ['identity', 'threadId', 'exit', 'stdout', 'stderr', 'exitCode']);
    assert.equal(worker.exit, true); assert.equal(worker.stdout, true); assert.equal(worker.stderr, true);
    assert(Number.isSafeInteger(worker.identity) && worker.identity > 0);
    assert(Number.isSafeInteger(worker.threadId)); assert(Number.isInteger(worker.exitCode));
  }
  return { id: cell.id, status: 'PASS', workers: final.workers.length };
}
export async function schedule(profile, host) {
  validateSelection(profile.cells);
  const timer = clock(host.started, host.now);
  const outcomes = [];
  let workerStarts = 0;
  const failures = ledger();
  try {
    await host.prepare(timer);
    for (const cell of profile.cells) {
      if (!timer.admit(10000)) break;
      await host.sample();
      if (!timer.admit(10000)) break;
      const outcome = await host.run(cell, timer);
      if (outcome.status !== 'PASS') { outcomes.push(outcome); timer.stop(); break; }
      workerStarts += outcome.workers;
      assert(workerStarts <= 24);
      outcomes.push(outcome);
      await host.sample();
    }
  } catch (reason) { failures.add(reason, 'schedule'); timer.stop(); }
  const seen = new Set(outcomes.map(row => row.id));
  for (const cell of profile.cells) if (!seen.has(cell.id)) outcomes.push({ id: cell.id, status: 'UNRUN' });
  try { await host.sample(); } catch (reason) { failures.add(reason, 'final-sample'); }
  const result = { outcomes, workerStarts, failure: describeLedger(failures.state), complete: outcomes.every(row => row.status === 'PASS') && !failures.state.present };
  try { timer.beforeEnd(); await host.publish(result); timer.beforeEnd(); } catch (reason) { failures.add(reason, 'publication'); result.failure = describeLedger(failures.state); result.complete = false; await host.emergency(result); }
  return result;
}
