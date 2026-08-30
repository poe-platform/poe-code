import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const manifest = JSON.parse(fs.readFileSync(process.env.FIXTURE_MANIFEST, 'utf8'));
const emit = event => fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(event) + '\n');
const options = () => ({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
assert.equal(createRequire(import.meta.url)('node:worker_threads').Worker, Worker);
emit({ kind: 'consumer-start' });
const role = process.env.NOVEL_ROLE;
if (role === 'N02') assert.throws(() => new Worker(pathToFileURL(manifest.applicationEntry), options()), /owned worker admission budget/);
else if (role === 'N08') assert.throws(() => new Worker(pathToFileURL(manifest.applicationEntry + '.wrong'), options()), /only selected RegexWorker is admitted/);
else if (role === 'N03') {
  assert.equal(globalThis.loaderReview.snapshot().ready, true);
  assert.throws(() => new Worker(pathToFileURL(manifest.applicationEntry), options()), { code: 'ERR_ASSERTION' });
  assert.equal(globalThis.loaderReview.snapshot().created, 0);
} else if (role === 'N05') {
  assert.equal(globalThis.loaderReview.snapshot().ready, true);
  const worker = new Worker(pathToFileURL(manifest.applicationEntry), options());
  const result = await new Promise(resolve => {
    let error, message;
    worker.on('error', value => { error = value; });
    worker.on('message', value => { message = value; });
    worker.once('exit', code => resolve({ error, message, code }));
  });
  assert.deepEqual(result, { error: undefined, message: 'OWNED_OK', code: 0 });
  assert.equal(globalThis.loaderReview.snapshot().live, 0);
  assert.throws(() => new Worker(pathToFileURL(manifest.applicationEntry), options()), { code: 'ERR_ASSERTION' });
  assert.equal(globalThis.loaderReview.snapshot().created, 1);
} else throw Error('unsealed role');
emit({ kind: 'refusal-observed', role });
console.log(JSON.stringify({ role, semantic: 'PASS' }));
