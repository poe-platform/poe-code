import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
const manifest = JSON.parse(fs.readFileSync(process.env.FIXTURE_MANIFEST, 'utf8'));
const emit = record => fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\n');
assert.equal(globalThis.loaderReview.snapshot().ready, true);
emit({ kind: 'consumer-start', caseId: process.env.CASE_ID });
const options = () => ({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
async function owned(Constructor) {
  const worker = new Constructor(new URL('file://' + manifest.applicationEntry), options());
  return new Promise(resolve => {
    let error, message;
    worker.once('error', reason => { error = reason; });
    worker.once('message', value => { message = value; });
    worker.once('exit', code => resolve({ error, message, code }));
  });
const id = process.env.CASE_ID;
if (id === 'P03') assert.throws(() => new Worker(new URL('file://' + manifest.applicationEntry), options()));
if (id === 'P04' || id === 'P08' || id === 'P09') {
  const Constructor = id === 'P08' ? createRequire(import.meta.url)('node:worker_threads').Worker : Worker;
  assert.equal(Constructor, Worker);
  if (id === 'P08') assert.throws(() => new Constructor(new URL('file://' + manifest.applicationEntry + '.wrong'), options()));
  const result = await owned(Constructor);
  if (id === 'P09') { assert.equal(result.error?.message, 'OWNED_WORKER_SENTINEL'); assert.equal(result.code, 1); }
  else { assert.equal(result.error, undefined); assert.equal(result.message, 'OWNED_OK'); assert.equal(result.code, 0); }
}
if (id === 'P05') assert.throws(() => new Worker(new URL('file://' + manifest.applicationEntry + '.wrong'), options()));
if (id === 'P06') {
  let getterCalls = 0;
  const invalid = [ { ...options(), eval: true }, { ...options(), execArgv: ['--loader', manifest.applicationEntry] }, { ...options(), resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 5 } }, { get execArgv() { getterCalls++; return []; }, resourceLimits: options().resourceLimits }, { ...options(), extra: true }, { ...options(), resourceLimits: { maxOldGenerationSizeMb: '128', stackSizeMb: 4 } } ];
  for (const value of invalid) assert.throws(() => new Worker(new URL('file://' + manifest.applicationEntry), value));
  assert.equal(getterCalls, 0);
  emit({ kind: 'six-option-refusals', count: invalid.length });
}
assert.equal(globalThis.loaderReview.snapshot().live, 0);
console.log(JSON.stringify({ caseId: id, semantic: 'PASS', ...globalThis.loaderReview.snapshot() }));
if (id === 'P10') process.exitCode = 7;
