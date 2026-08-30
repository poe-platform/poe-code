import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { hash } from './common.mjs';
import { run } from './adapter.mjs';
import { lifecycle } from './lifecycle.mjs';
import { installLoader } from '../actual-review-v1/loader.mjs';

const raw = await readFile(process.argv[2]); assert.equal(hash(raw), process.argv[3]); const job = JSON.parse(raw);
const emit = async record => { if (!process.stdout.write(`${JSON.stringify(record)}\n`)) await once(process.stdout, 'drain'); };
const loads = installLoader(job.root, job.entries, job.builtinMap);
const module = await import(pathToFileURL(path.join(job.root, 'dist/commands/xan/index.js')).href);
const contracts = await import(pathToFileURL(path.join(job.root, 'dist/contracts/index.js')).href);
const api = await import(pathToFileURL(path.join(job.root, 'dist/index.js')).href);
let failures = 0; let completedCount = 0; let closed = true;
for (const control of job.jobs) {
  let status = 'PASS'; let failure; let reason;
  try {
    const context = { job: control, module, contracts, api, documents: job.documents, rows: job.rows, limits: job.limits, emit, layout: job };
    const result = control.kind === 'shell-lifecycle' ? await lifecycle(context) : await run(context);
    status = result?.status ?? status; reason = result?.reason;
  } catch (error) { status = 'FAIL'; failure = { name: error.name, message: error.message, stack: error.stack, observation: error.observation }; if (error.name === 'CleanupFailure') closed = false; }
  if (status !== 'PASS') failures++;
  await emit({ stage: 'CASE', id: control.id, kind: control.kind, status, closed, intact: true, failure, reason }); completedCount++;
  if (!closed) break;
}
await emit({ stage: 'ACTUAL_LOADS', layout: job.layout, loads });
await emit({ stage: 'FINALIZATION', job: job.job, phase: job.phase, nonce: job.nonce, manifest: job.manifest,
  requiredIds: job.requiredIds, requiredCount: job.requiredIds.length, completedCount, failures, complete: completedCount === job.requiredIds.length, closed, intact: true });
process.exitCode = failures ? 1 : 0;
