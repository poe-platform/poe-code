import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import workers from 'node:worker_threads';
import { readJson, sha } from './admission.mjs';
import { observeWorkers } from './worker-observer.mjs';

const [mode, output] = process.argv.slice(2);
assert.ok(['natural', 'product-forced', 'emergency', 'error', 'loader-drift', 'late-acquisition', 'concurrent-bound', 'cumulative-bound'].includes(mode));
const own = path.dirname(fileURLToPath(import.meta.url));
const protocol = readJson(path.join(own, 'STUB-PROTOCOL-v2.json'));
for (const row of protocol.files) assert.equal(sha(fs.readFileSync(path.join(own, row.path))), row.sha256, row.path);
const files = {};
for (const name of ['stub-entry.mjs', 'stub-dependency.mjs', 'stub-guard.mjs', 'admission.mjs', 'worker-preload.mjs']) files[path.join(own, name)] = { sha256: sha(fs.readFileSync(path.join(own, name))), relative: name, role: 'benign-stub-or-harness' };
if (mode === 'loader-drift') files[path.join(own, 'stub-dependency.mjs')].sha256 = '0'.repeat(64);
const observer = observeWorkers({
  files, entry: pathToFileURL(path.join(own, 'stub-entry.mjs')).href, preload: pathToFileURL(path.join(own, 'worker-preload.mjs')).href,
  guard: pathToFileURL(path.join(own, 'stub-guard.mjs')).href, token: mode, log: path.join(output, mode + '.worker.jsonl'), parentLog: path.join(output, mode + '.parent.jsonl'),
  maxStarts: 4, maxConcurrent: 2, captureBytes: 131072, cleanupMs: 1000,
  stubMode: ['natural', 'cumulative-bound'].includes(mode) ? 'natural' : mode === 'error' ? 'error' : 'hold',
});
const options = { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } };
const create = () => new workers.Worker(new URL('./stub-entry.mjs', import.meta.url), options);
const ready = worker => new Promise((resolve, reject) => { worker.once('message', value => { assert.equal(value, 'stub-ready'); resolve(); }); worker.once('error', reject); });
const exit = worker => new Promise(resolve => worker.once('exit', resolve));
let pass = false, failure, expectedRefusal;
try {
  if (mode === 'late-acquisition') {
    await observer.close(); assert.throws(create, /LATE_WORKER_ACQUISITION_STOP/u); expectedRefusal = 'LATE_WORKER_ACQUISITION_STOP';
  } else if (mode === 'cumulative-bound') {
    for (let count = 0; count < 4; count++) await exit(create());
    assert.throws(create, /WORKER_START_BOUND/u); expectedRefusal = 'WORKER_START_BOUND'; await observer.close();
  } else if (mode === 'concurrent-bound') {
    const first = create(), second = create(); await Promise.all([ready(first), ready(second)]);
    assert.throws(create, /WORKER_START_BOUND/u); expectedRefusal = 'WORKER_START_BOUND';
    await Promise.all([first.terminate(), second.terminate()]); await observer.close();
  } else {
    const worker = create(), reaped = exit(worker);
    if (['error', 'loader-drift'].includes(mode)) {
      await reaped; assert.equal(observer.rows[0].errors.length, 1);
      assert.ok(observer.rows[0].errors[0].includes(mode === 'error' ? 'INTENTIONAL_BENIGN_STUB_ERROR' : 'LOAD_HASH_REFUSED'));
      await observer.close();
    } else if (mode === 'natural') { await reaped; await observer.close(); }
    else {
      await ready(worker);
      if (mode === 'product-forced') { await worker.terminate(); await reaped; await observer.close(); assert.equal(observer.rows[0].productTerminateCalls, 1); }
      else { await assert.rejects(observer.close(), /EMERGENCY_RETIREMENT_STOP/u); await reaped; expectedRefusal = 'EMERGENCY_RETIREMENT_STOP'; }
    }
  }
  assert.ok(observer.rows.every(row => row.exited && row.terminatePending === 0)); pass = true;
} catch (error) { failure = { message: String(error), stack: error?.stack }; try { await observer.close(); } catch {} }
console.log(JSON.stringify({ role: 'BENIGN_STUB_ONLY_NOT_PRODUCT_PROOF', mode, pass, failure, expectedRefusal, admissionRefusals: observer.admissionRefusals, rows: observer.rows.map(({ reaped, ...row }) => row), productImports: 0, productDispatches: 0 }));
if (!pass) process.exitCode = 1;
