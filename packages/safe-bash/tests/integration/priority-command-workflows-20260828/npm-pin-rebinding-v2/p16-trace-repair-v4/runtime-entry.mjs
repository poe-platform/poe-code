import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readJson, requireGrant, sha, checkPacket, bounds, admitFile } from './admission.mjs';
import { observeWorkers } from './worker-observer.mjs';
import { runCase } from './future-adapter.mjs';

const configuration = readJson(process.env.RUN_CONFIGURATION);
const grantBytes = fs.readFileSync(configuration.grant);
const grant = JSON.parse(grantBytes);
requireGrant(grant, fs.readFileSync(configuration.seal));
assert.equal(sha(grantBytes), configuration.grantSha256);
const layout = grant.layouts.find(row => row.name === configuration.layout);
assert.ok(layout); assert.equal(layout.appParent, fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/u, ''));
assert.equal(configuration.specifier, layout.specifier); assert.ok(grant.ids.includes(configuration.id)); assert.ok(grant.selection.includes(`${configuration.layout}:${configuration.id}`), 'UNSELECTED_CALL_REFUSED');
const { cases, fixtures } = checkPacket();
const admission = readJson(process.env.ADMISSION);
assert.equal(admission.product, layout.product);
const observer = observeWorkers({
  files: admission.files, entry: pathToFileURL(layout.product + '/dist/commands/regex-execution/worker.js').href,
  preload: new URL('./worker-preload.mjs', import.meta.url).href, guard: new URL('./guard.mjs', import.meta.url).href,
  token: configuration.layout + ':' + configuration.id, log: configuration.workerLog, parentLog: configuration.workerParentLog,
  maxStarts: Math.min(bounds.workerStartsPerChild, configuration.workerStartsRemaining), maxConcurrent: bounds.concurrentWorkers,
  captureBytes: configuration.workerCaptureBytes, cleanupMs: bounds.cleanupMs,
});
let observation;
try {
  const resolved = import.meta.resolve(configuration.specifier);
  assert.equal(resolved, pathToFileURL(layout.product + '/dist/index.js').href, 'PUBLIC_RESOLUTION_ONLY');
  admitFile(resolved, admission.files);
  const api = await import(configuration.specifier);
  const row = [...cases.workflows, ...cases.controls].find(row => row.id === configuration.id);
  observation = await runCase(api, row, fixtures.rows.find(row => row.id === configuration.id), cases.defaults, fixtures.networkLimits);
} catch (error) { observation = { id: configuration.id, pass: false, safetyStops: [{ code: 'RUNTIME_SETUP_OR_TRACE_STOP', message: String(error) }], failures: [{ kind: 'runtime', message: String(error), stack: error?.stack }] }; }
finally {
  try { observation.workers = await observer.close(); }
  catch (error) { observation.pass = false; observation.safetyStops.push({ code: 'WORKER_CLEANUP_STOP', message: String(error) }); observation.failures.push({ kind: 'worker-cleanup', message: String(error) }); observation.workers = observer.rows.map(({ reaped, ...row }) => row); }
}
observation.layout = configuration.layout;
observation.workerAdmissionRefusals = observer.admissionRefusals;
if (observer.admissionRefusals.length || observation.workers.some(row => row.childAdmissionRefused)) observation.pass = false;
console.log(JSON.stringify(observation));
if (!observation.pass) process.exitCode = 1;
