import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import workers from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJson, sha, requireCleanSafety } from './admission.mjs';
import { observeWorkers } from './worker-observer.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const [mode, output] = process.argv.slice(2);
const protocol = readJson(path.join(own, 'REPAIR-PROTOCOL-v3.json'));
assert.ok(protocol.stubModes.includes(mode)); assert.equal(output, protocol.output);
for (const row of protocol.files) assert.equal(sha(fs.readFileSync(path.join(own, row.path))), row.sha256, row.path);
await import('./stub-guard.mjs');
const files = {};
for (const name of ['stub-entry.mjs', 'stub-dependency.mjs', 'stub-guard.mjs', 'admission.mjs', 'worker-preload.mjs']) files[path.join(own, name)] = { sha256: sha(fs.readFileSync(path.join(own, name))), relative: name, role: 'benign-stub-or-harness' };
if (['caught-load', 'mapped-load'].includes(mode)) files[path.join(own, 'stub-dependency.mjs')].sha256 = '0'.repeat(64);
const observer = observeWorkers({
  files, entry: pathToFileURL(path.join(own, 'stub-entry.mjs')).href, preload: pathToFileURL(path.join(own, 'worker-preload.mjs')).href,
  guard: pathToFileURL(path.join(own, 'stub-guard.mjs')).href, token: mode,
  log: path.join(output, mode + '.worker.jsonl'), parentLog: path.join(output, mode + '.parent.jsonl'),
  maxStarts: 1, maxConcurrent: 1, captureBytes: 131072, cleanupMs: 1000,
  stubMode: mode === 'independent-cleanup' ? 'hold' : mode === 'caught-load' ? 'caught-load' : 'natural',
});
const options = { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } };
const create = () => new workers.Worker(new URL('./stub-entry.mjs', import.meta.url), options);
let pass = false, failure, mappedOutcome, listenerRemoved = false;
const baselineListeners = process.listenerCount('unhandledRejection');
const listener = () => {};
process.on('unhandledRejection', listener);
const messages = [];
try {
  const worker = create();
  worker.on('message', message => messages.push(message));
  worker.on('error', error => { mappedOutcome = { exitCode: 1, message: String(error) }; });
  const reaped = new Promise(resolve => worker.once('exit', resolve));
  if (mode === 'independent-cleanup') {
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    assert.throws(() => new workers.Worker(new URL('./stub-dependency.mjs', import.meta.url), options), /WORKER_URL_DRIFT/u);
    await worker.terminate();
  }
  await reaped;
} catch (error) { failure = { message: String(error), stack: error.stack }; }
finally {
  try { await observer.close(); } catch (error) { failure ??= { message: String(error), stack: error.stack }; }
  process.removeListener('unhandledRejection', listener);
  listenerRemoved = process.listenerCount('unhandledRejection') === baselineListeners;
}
const rows = observer.rows.map(({ reaped, ...row }) => row);
const loads = fs.existsSync(path.join(output, mode + '.worker.jsonl')) ? fs.readFileSync(path.join(output, mode + '.worker.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
try {
  assert.equal(failure, undefined); assert.equal(listenerRemoved, true);
  assert.ok(rows.every(row => row.exited && row.terminatePending === 0 && !row.emergency));
  const record = { safetyStops: [], workerAdmissionRefusals: observer.admissionRefusals, workers: rows, pass: true };
  if (mode === 'natural') requireCleanSafety(record, loads);
  else assert.throws(() => requireCleanSafety(record, loads), /(?:WORKER_ADMISSION_STOP|CHILD_LOAD_ADMISSION_STOP)/u);
  if (['caught-load', 'mapped-load'].includes(mode)) {
    assert.equal(rows[0].childAdmissionRefused, true);
    const refusal = loads.find(row => row.event === 'admission-refused');
    assert.equal(refusal.url, new URL('./stub-dependency.mjs', import.meta.url).href);
    assert.match(refusal.reason, /LOAD_HASH_REFUSED/u);
    assert.ok(loads.some(row => row.event === 'load' && row.relative === 'stub-entry.mjs'));
    if (mode === 'caught-load') { assert.equal(rows[0].exitCode, 0); assert.equal(rows[0].errors.length, 0); assert.match(messages[0].caught, /LOAD_HASH_REFUSED/u); }
    else { assert.equal(mappedOutcome.exitCode, 1); assert.match(mappedOutcome.message, /LOAD_HASH_REFUSED/u); }
  }
  pass = true;
} catch (error) { failure = { message: String(error), stack: error.stack }; }
console.log(JSON.stringify({ role: 'BENIGN_STUB_ONLY_NOT_PRODUCT_PROOF', mode, pass, failure, mappedOutcome, messages, listenerRemoved, rows, admissionRefusals: observer.admissionRefusals, productImports: 0, productDispatches: 0 }));
if (!pass) process.exitCode = 1;
