import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { supervise, IntegrityFailure } from '../preparation-v2/supervisor.mjs';
import { verifyCommitted } from '../preparation-v2/integrity.mjs';
import { digest, durable, runAdmitted } from './a01.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const recipe = process.argv[2];
assert.match(recipe, /^[a-f0-9]{40}$/);
const files = ['a01.mjs', 'a01-fixture.mjs', 'qualify-a01.mjs', 'A01-RECIPE.json'];
async function verify() {
  await verifyCommitted('0a02e846b3f4985cad4394187717ceabd0188f25');
  for (const name of files) {
    const current = await readFile(path.join(root, name));
    const committed = execFileSync('git', ['show', `${recipe}:tests/commands/xan-module-review-20260828/actual-review-v1/${name}`], { maxBuffer: current.length });
    assert.deepEqual(current, committed);
  }
}
await verify();
const configuration = JSON.parse(await readFile(path.join(root, 'A01-RECIPE.json'), 'utf8'));
const directory = path.join(root, 'a01-evidence');
await mkdir(directory);
await durable(path.join(directory, 'PRE-RUN.json'), { recipe, started: new Date().toISOString(), configuration, product: 0 });
const results = [];
let children = 0;
for (const [index, variant] of configuration.controls.entries()) {
  const events = [];
  let continued = false;
  const expected = { job: `control-${index}`, phase: 'REQUIRED', manifest: digest(JSON.stringify(configuration)), nonce: `a01-${index}`, requiredIds: ['case', 'control'], rawBound: 16384 };
  const childDirectory = path.join(directory, expected.job);
  const seen = new Set();
  if (variant === 'replayed-receipt') seen.add(`${expected.nonce}:${expected.job}:${expected.phase}:${expected.manifest}`);
  const tasks = [{ expected, rawFile: path.join(childDirectory, 'stdout.raw'), async run() {
    const receipt = await supervise({ executable: process.execPath, args: [path.join(root, 'a01-fixture.mjs'), variant, JSON.stringify(expected)], cwd: root,
      directory: childDirectory, timeoutMs: 5000, rawBytes: expected.rawBound, kind: 'A01_SYNTHETIC_NOT_PRODUCT' });
    children++; assert.equal(receipt.reaped, true);
    if (variant === 'unreaped-receipt') return { ...receipt, reaped: false };
    if (variant === 'raw-hash-mismatch') return { ...receipt, logs: [{ ...receipt.logs[0], artifactSha256: 'wrong' }] };
    return receipt;
  } }, { expected: { ...expected, job: 'dependent' }, rawFile: '', async run() { continued = true; throw new Error('DEPENDENT_REACHED_MARKER'); } }];
  let held = false;
  let ordinaryFailure = false;
  try {
    await runAdmitted(tasks, async () => { await verify(); if (variant === 'post-integrity-failure') throw new Error('synthetic appended file'); }, async event => {
      events.push(event); await durable(path.join(directory, `${expected.job}-event-${events.length}.json`), event);
      if (event.status === 'ASSERTION_FAILED') ordinaryFailure = true;
    }, seen);
  } catch (error) {
    if (error instanceof IntegrityFailure) held = true;
    else assert.equal(error.message, 'DEPENDENT_REACHED_MARKER');
  }
  const expectedContinue = ['valid', 'failed-required-case', 'failed-required-control', 'failed-case-exit-zero', 'nonzero-child'].includes(variant);
  const observed = { variant, held, continued, ordinaryFailure, events: events.length };
  await durable(path.join(directory, `${expected.job}-result.json`), observed);
  let failure;
  try { assert.equal(continued, expectedContinue); assert.equal(held, !expectedContinue); assert.equal(ordinaryFailure, expectedContinue && variant !== 'valid'); }
  catch (error) { failure = error.message; }
  results.push({ ...observed, qualified: !failure, failure });
}
const summary = { recipe, ended: new Date().toISOString(), planned: configuration.controls.length, qualified: results.filter(row => row.qualified).length,
  failed: results.filter(row => !row.qualified).length, children, reaped: children, product: 0, results };
await durable(path.join(directory, 'SUMMARY.json'), summary);
console.log(JSON.stringify({ ...summary, results: undefined }));
process.exitCode = summary.failed ? 1 : 0;
