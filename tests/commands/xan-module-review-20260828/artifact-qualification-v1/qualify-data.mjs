import { readFile, writeFile, open, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { qualifyDatum, mutateDatum } from './predicate.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const review = dirname(owned);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const preBytes = await readFile(join(owned, 'PRE-SEAL.json'));
const pre = JSON.parse(preBytes);
const commit = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('explicit preseal commit argument required; no Git subprocess');
const attempt = join(owned, 'attempt-1');
await mkdir(attempt);
async function durable(path, value) {
  await writeFile(join(attempt, path), JSON.stringify(value) + '\n', { flag: 'wx' });
  const handle = await open(join(attempt, path), 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}
await durable('START.json', { classification: 'ONE_DATA_ONLY_QUALIFICATION', startedAt: new Date().toISOString(), presealCommit: commit, presealSha256: sha(preBytes), productInvocations: 0 });
const integrity = async () => {
  const failures = [];
  const expectedPaths = [...pre.entries.map(row => row.path), 'PRE-SEAL.json', 'attempt-1'].sort();
  if (JSON.stringify((await readdir(owned)).sort()) !== JSON.stringify(expectedPaths)) failures.push('owned namespace append/remove');
  for (const row of pre.entries) {
    const bytes = await readFile(join(owned, row.path));
    if (sha(bytes) !== row.sha256 || bytes.length !== row.bytes) failures.push(`owned bytes ${row.path}`);
  }
  for (const row of pre.inputs) {
    const bytes = await readFile(join(review, row.path));
    if (sha(bytes) !== row.sha256 || bytes.length !== row.bytes) failures.push(`read-only input ${row.path}`);
  }
  if (sha(await readFile(process.execPath)) !== pre.tool.sha256 || process.version !== pre.tool.version) failures.push('data tool identity');
  return failures;
};
try {
  const before = await integrity();
  if (before.length) throw new Error(before.join('; '));
  const data = JSON.parse(await readFile(join(owned, 'DATA.json')));
  const controls = JSON.parse(await readFile(join(owned, 'CONTROLS.json')));
  const rows = new Map([...data.held, ...data.guards].map(row => [row.key, row]));
  const decisions = [];
  for (const row of data.held) decisions.push({ id: row.key, type: 'EXISTING_DIAGNOSTIC_DATA_CHECK', origin: 'EXACT_HISTORICAL_RAW_NOT_RUNTIME_RERUN', ...qualifyDatum(row.expected, row.datum) });
  for (const control of controls.controls) {
    const row = rows.get(control.key);
    const datum = mutateDatum(row.datum, control.operation);
    decisions.push({ id: control.id, type: 'SYNTHETIC_DATA_CONTROL', operation: control.operation, datumSha256: sha(JSON.stringify(datum)), ...qualifyDatum(row.expected, datum) });
  }
  await durable('RAW-DECISIONS.json', { classification: 'RAW_DATA_DECISIONS_BEFORE_EXPECTATION_ASSERTIONS', decisions });
  const failures = [];
  const checks = [];
  for (const decision of decisions) {
    const expectedQualified = decision.type === 'EXISTING_DIAGNOSTIC_DATA_CHECK' ? true : controls.controls.find(control => control.id === decision.id).expectedQualified;
    const correct = decision.qualified === expectedQualified;
    checks.push({ id: decision.id, expectedQualified, actualQualified: decision.qualified, correct });
    if (!correct) failures.push(decision.id);
  }
  const after = await integrity();
  failures.push(...after);
  const result = { classification: 'DATA_QUALIFICATION_ONLY_NOT_CORRECTED_PRODUCT_PASSES', presealCommit: commit, presealSha256: sha(preBytes), attempts: 1, retries: 0, counters: controls.counters, correctDecisions: checks.filter(row => row.correct).length, failedAssertions: failures, checks, integrity: { before, after, ownedEnumerationAppendAware: true, externalInputsListedPathsOnly: true }, productInvocations: 0, oldControlsRerun: 0, oldOutcomesUnchanged: { SOURCE: '569/79/19', INSTALLED_MOVED: '570/79/18' } };
  await durable('RESULT.json', result);
  console.log(JSON.stringify({ counters: controls.counters, correctDecisions: result.correctDecisions, failures }));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await durable('ERROR.json', { classification: 'DATA_ATTEMPT_ERROR_NO_RETRY', message: error.message, productInvocations: 0 });
  console.error(error.message);
  process.exitCode = 1;
}
