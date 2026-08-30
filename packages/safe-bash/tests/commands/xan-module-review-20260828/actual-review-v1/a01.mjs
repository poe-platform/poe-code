import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { aggregate, IntegrityFailure } from '../preparation-v2/supervisor.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export async function durable(filename, value) {
  const file = await open(filename, 'wx', 0o644);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
}

export async function admitFinal({ expected, processReceipt, rawFile, seen, verify, capture }) {
  const raw = await readFile(rawFile);
  await capture({ stage: 'DURABLE_RAW_BEFORE_ADMISSION', rawSha256: digest(raw), bytes: raw.length, processReceipt });
  try {
    assert.equal(processReceipt.reaped, true);
    assert.equal(processReceipt.timeout, false);
    assert.equal(processReceipt.overflow, false);
    assert.equal(processReceipt.signal, null);
    assert.equal(processReceipt.spawnError, null);
    assert.ok(raw.length <= expected.rawBound);
    assert.equal(digest(raw), processReceipt.logs[0].artifactSha256);
    assert.equal(raw.length, processReceipt.logs[0].artifactBytes);
    assert.equal(processReceipt.logs[0].truncated, false);
    const records = raw.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const finals = records.filter(record => record.stage === 'FINALIZATION');
    assert.equal(finals.length, 1, 'exactly one finalization');
    const final = finals[0];
    assert.equal(records.at(-1), final, 'finalization must be final record');
    for (const key of ['job', 'phase', 'manifest', 'nonce']) assert.equal(final[key], expected[key], `receipt ${key}`);
    assert.equal(final.complete, true);
    assert.equal(final.closed, true);
    assert.equal(final.intact, true);
    assert.deepEqual(final.requiredIds, expected.requiredIds);
    assert.equal(final.requiredCount, expected.requiredIds.length);
    assert.equal(new Set(final.requiredIds).size, final.requiredIds.length);
    const cases = records.filter(record => record.stage === 'CASE');
    assert.deepEqual(cases.map(record => record.id), expected.requiredIds, 'all required IDs exactly once');
    assert.ok(cases.every(record => ['PASS', 'FAIL', 'BLOCKED'].includes(record.status)));
    assert.ok(cases.every(record => record.closed === true && record.intact === true));
    const failures = cases.filter(record => record.status !== 'PASS').length;
    assert.equal(final.failures, failures);
    assert.equal(final.completedCount, cases.length);
    const identity = `${expected.nonce}:${expected.job}:${expected.phase}:${expected.manifest}`;
    assert.equal(seen.has(identity), false, 'replayed receipt');
    await verify();
    seen.add(identity);
    return { ...final, exitCode: processReceipt.code, reaped: true, requiredPhase: expected.phase,
      completedPhase: final.phase, rawBoundExceeded: false, failures };
  } catch (error) {
    throw new IntegrityFailure(`A01_HOLD_DEPENDENTS: ${error.message}`);
  }
}

export async function runAdmitted(tasks, verify, emit, seen = new Set()) {
  return aggregate(tasks.map(task => ({
    id: task.expected.job,
    async run() {
      const processReceipt = await task.run();
      return admitFinal({ expected: task.expected, processReceipt, rawFile: task.rawFile, seen, verify,
        capture: value => emit({ job: task.expected.job, ...value }) });
    },
    async assert(result) { assert.equal(result.failures, 0, 'required case/control failed'); },
  })), verify, emit);
}
