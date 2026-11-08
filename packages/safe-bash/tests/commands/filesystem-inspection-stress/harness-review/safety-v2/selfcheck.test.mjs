import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCases } from './cases.mjs';
import { verifySeal, digest, directory } from './seal.mjs';
import { evaluate, assertWorkDiagnostic } from './oracle.mjs';
import { fixtureFs } from './vfs.mjs';
import { authorize, checkPremise } from './authorization.mjs';
import { verifySeal as originalSeal } from '../safety-v1/seal.mjs';

test('two rows differ only in declared budget and expectations', () => {
  const original = originalSeal();
  const derived = verifySeal();
  assert.deepEqual(derived.cases.map(entry => entry.id), ['T-DP-cumulative', 'T-sort-many']);
  assert.deepEqual(derived.cases, buildCases());
  for (const entry of derived.cases) {
    const previous = original.cases.find(value => value.id === entry.id);
    assert.deepEqual({ ...entry, limits: previous.limits, expected: previous.expected }, previous);
    assert.deepEqual(entry.limits, { ...previous.limits, maxSteps: entry.id === 'T-DP-cumulative' ? 16384 : 4096 });
    assert.equal(entry.entries.length, 66);
  }
});

test('pure arithmetic establishes singleton fit and fourth-filter failure', () => {
  const startup = 18 + 18 + 17 + 2;
  const filter = 1 + 1 + 129 + 17 * 258;
  assert.equal(startup + filter + 1, 4573);
  assert.equal(startup + 3 * filter, 13606);
  assert.equal(startup + 4 * filter, 18123);
  assert.equal(startup + 3 * filter + 1 + 1 + 129 + 10 * 258, 16317);
  assert.equal(startup + 3 * filter + 1 + 1 + 129 + 11 * 258, 16575);
  assert.equal(2 + 64 + 3 * 1025, 3141);
  assert.equal(2 + 64 + 4 * 1025, 4166);
});

test('exact recorded helper transformations preserve all other bytes', () => {
  const derivation = JSON.parse(readFileSync(join(directory, 'derivation.json')));
  for (const entry of derivation.transformations) {
    let text = readFileSync(join(directory, '../safety-v1', entry.name), 'utf8');
    assert.equal(digest(text), entry.originalSha256);
    for (const [before, after] of entry.replacements) {
      assert.equal(text.split(before).length, 2);
      text = text.replace(before, after);
    }
    assert.equal(text, readFileSync(join(directory, entry.name), 'utf8'));
    assert.equal(digest(text), entry.derivedSha256);
  }
  assert.equal(readFileSync(join(directory, 'child.mjs'), 'utf8'), readFileSync(join(directory, '../safety-v1/child.mjs'), 'utf8'));
});

async function mockReport(entry) {
  const trace = { calls: [], streams: [], mutations: 0 };
  class MockFsError extends Error {}
  const fs = fixtureFs(entry, MockFsError, trace);
  const options = { signal: new AbortController().signal };
  await fs.lstat('/root', options);
  const listing = await fs.readdir('/root', options);
  assert(Array.isArray(listing));
  assert.equal(listing.length, 64);
  let count = 0;
  for (const item of listing) {
    assert.equal(item.name, entry.entries[count + 2].path.slice(6));
    count++;
    if (entry.id === 'T-DP-cumulative' && count === 4) break;
  }
  const stderr = `shell: line 1: EFBIG: tree work limit exceeded (${entry.limits.maxSteps})\n`;
  return { id: entry.id, actualShell: true, shellDisposed: true, commandInvocations: 1,
    ...trace, unhandled: [], rejected: false, exitCode: 1, stdout: '', stderr,
    stdoutBase64: '', stderrBase64: Buffer.from(stderr).toString('base64'), stdoutBytes: 0, stderrBytes: Buffer.byteLength(stderr) };
}

for (const entry of buildCases()) {
  test(`${entry.id}: real fixture telemetry with synthetic Shell reply; negative controls`, async () => {
    const report = await mockReport(entry);
    assert.equal(evaluate(entry, report).status, 'pass');
    const mutations = [
      value => { value.rejected = true; },
      value => { value.exitCode = 0; },
      value => { value.exitCode = 2; },
      value => { value.shellDisposed = false; },
      value => { value.commandInvocations = 2; },
      value => { value.mutations = 1; },
      value => { value.unhandled.push('late mock rejection'); },
      value => { value.calls[0].signalPresent = false; },
      value => { value.calls.push({ ...value.calls[0], path: entry.entries[2].path }); },
      value => { value.listings[0].yielded = 1; },
      value => { value.listings[0].names[0] = 'unsealed'; },
      value => { value.listings[0].done = !value.listings[0].done; },
      value => { value.listings[0].returned++; },
    ];
    if (entry.id === 'T-DP-cumulative') mutations.push(value => {
      value.listings[0] = { path: '/root', next: 65, yielded: 64, done: true, returned: 0, names: entry.entries.slice(2).map(item => item.path.slice(6)) };
    });
    for (const mutate of mutations) {
      const negative = structuredClone(report);
      mutate(negative);
      assert.throws(() => evaluate(entry, negative));
    }
  });
}

test('bounded diagnostic grammar rejects unrelated, wrong-budget and status-only surrogates', () => {
  for (const text of ['shell: line 1: EFBIG: tree work limit exceeded (16384)\n', 'tree: work limit exceeded (16384)\n', 'tree work limit exceeded (16384)\n']) assertWorkDiagnostic(text, 16384);
  for (const text of ['', '\n', 'error\n', 'tree output limit exceeded (16384)\n', 'file work limit exceeded (16384)\n', 'tree work limit exceeded (4096)\n', 'tree work limit exceeded (16384)\nsuccess\n', 'width failed; tree work limit exceeded (16384)\n', 'shell: line 0: tree work limit exceeded (16384)\n', 'x'.repeat(513)]) assert.throws(() => assertWorkDiagnostic(text, 16384));
});

test('review-pending proposal cannot execute; invalid proof coefficients reject', () => {
  const path = join(directory, 'root-review-proposal.json');
  const bytes = readFileSync(path);
  assert.throws(() => authorize(path, digest(bytes)), /ROOT_TWO_ROW_CORRECTION_EXECUTION_AUTHORIZED/u);
  assert(!existsSync('/tmp/safe-bash-inspection-derived-two-436bda3-execution-claim.json'));
  const proposal = JSON.parse(bytes);
  for (const entry of buildCases()) {
    const mockProof = { ...proposal.proofs[entry.expected.proof], status: 'approved' };
    checkPremise(entry, mockProof);
    assert.throws(() => checkPremise(entry, { ...mockProof, perOperandReset: true }));
    assert.throws(() => checkPremise(entry, { ...mockProof, acceptedWorkBeforeFailure: 0 }));
    assert.throws(() => checkPremise(entry, { ...mockProof, shellReturnsStatusOne: false }));
  }
});
