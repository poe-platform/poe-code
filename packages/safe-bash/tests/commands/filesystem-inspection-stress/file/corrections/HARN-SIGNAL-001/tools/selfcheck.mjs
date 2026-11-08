import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const correction = JSON.parse(await readFile(join(root, 'correction.json')));
const original = await readFile(join(root, 'history/original-isolated-runner.mjs'), 'utf8');
const corrected = await readFile(join(root, 'holdout/corrected-assertions-runner.mjs'), 'utf8');
const observed = await readFile(join(root, 'holdout/corrected-observed-runner.mjs'), 'utf8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('only two authorized assertion replacements; exact original is recoverable', () => {
  assert.equal(correction.corrections.length, 2);
  assert.deepEqual(correction.authorizedCases, ['F29', 'F33', 'F34']);
  let restored = corrected;
  for (const replacement of [...correction.corrections].reverse()) {
    assert.equal(restored.split(replacement.after).length, 2);
    restored = restored.replace(replacement.after, replacement.before);
  }
  assert.equal(restored, original);
  assert.equal(hash(original), correction.originalIsolatedRunnerSha256);
  assert.equal(hash(corrected), correction.correctedAssertionsRunnerSha256);
});

test('F29 exact derived block accepts active composed signals and rejects invalid state', () => {
  const check = new Function('assert', 'rig', correction.corrections[0].after);
  const caller = new AbortController();
  const local = new AbortController();
  const composed = AbortSignal.any([caller.signal, local.signal]);
  assert.notEqual(composed, caller.signal);
  check(assert, { trace: [{ options: { signal: composed } }] });
  assert.throws(() => check(assert, { trace: [{ options: {} }] }), assert.AssertionError);
  assert.throws(() => check(assert, { trace: [{ options: { signal: { aborted: false } } }] }), assert.AssertionError);
  caller.abort(new Error('selfcheck abort'));
  assert.throws(() => check(assert, { trace: [{ options: { signal: composed } }] }), assert.AssertionError);
});

test('F33/F34 exact derived block demands aborted state and exact reason identity', () => {
  const check = new Function('assert', 'capturedSignal', 'reason', correction.corrections[1].after);
  const reason = Object.assign(new Error('selfcheck sentinel'), { code: 'ENOENT' });
  const caller = new AbortController();
  const composed = AbortSignal.any([caller.signal, new AbortController().signal]);
  assert.throws(() => check(assert, composed, reason), assert.AssertionError);
  caller.abort(reason);
  check(assert, composed, reason);
  assert.notEqual(composed, caller.signal);
  assert.throws(() => check(assert, composed, Object.assign(new Error('selfcheck sentinel'), { code: 'ENOENT' })), assert.AssertionError);
  assert.throws(() => check(assert, { aborted: true, reason }, reason), assert.AssertionError);
});

test('telemetry is reversible and preserves cleanup/rejection assertions without handlers', () => {
  let restored = observed;
  for (const replacement of [...correction.observations].reverse()) {
    assert.equal(restored.split(replacement.after).length, 2);
    restored = restored.replace(replacement.after, replacement.before);
    assert(!replacement.after.includes('.catch('));
    assert(!replacement.after.includes('.then('));
  }
  assert.equal(restored, corrected);
  assert.equal(hash(observed), correction.correctedObservedRunnerSha256);
  for (const unchanged of [
    'await assert.rejects(deadline(invocation.promise, `${id} cancellation`), (error) => error === reason);',
    'assert.equal(returned, 1);',
    'pendingRead.reject(lateReadError);',
    'pendingReturn.reject(lateReturnError);',
    'await turn();\n      await turn();\n      assert.deepEqual(unhandled, []);',
  ]) assert(observed.includes(unchanged), unchanged);
});

test('candidate inputs and three-case selection remain pinned; no fixture predicates change', async () => {
  const freeze = JSON.parse(await readFile(join(root, 'freeze.json')));
  assert.equal(freeze.commit, 'd168d18b118592e04a6eec9b00eb50cc2b1e5058');
  const child = await readFile(join(root, 'child.mjs'), 'utf8');
  assert(child.includes("assert(['F29', 'F33', 'F34'].includes(caseId)"));
  assert(!child.includes('/Users/kjopek/Workspace/safe-bash/src/'));
  assert(!child.includes("from './candidate/"));
  const originalCatalog = JSON.parse(await readFile(join(root, 'holdout/seal-catalog.json')));
  for (const name of ['corpus.mjs', 'cases.json', 'expectations.json', 'fixture-manifest.json', 'native-observations.json', 'run-holdouts.mjs']) {
    const entry = originalCatalog.artifacts.find((artifact) => artifact.relativePath === name);
    assert.equal(hash(await readFile(join(root, 'holdout', name))), entry.sha256, name);
  }
});
