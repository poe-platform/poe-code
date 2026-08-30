import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ROOT, durable, hash } from './common.mjs';
import { admitFinal } from '../actual-review-v1/a01.mjs';

await mkdir(path.join(ROOT, 'controls-work'));
const expected = { job: 'actual-parent-control', phase: 'MODULE', nonce: 'control-only', manifest: 'sealed-control', requiredIds: ['required'], rawBound: 65536 };
const original = [{ stage: 'CASE', id: 'required', status: 'PASS', closed: true, intact: true },
  { stage: 'FINALIZATION', ...expected, requiredCount: 1, completedCount: 1, failures: 0, complete: true, closed: true, intact: true }];
const records = [];
for (const kind of ['valid', 'missing', 'duplicate', 'stale', 'wrong-manifest', 'wrong-count', 'unclosed', 'incomplete', 'missing-case', 'nonfinal', 'ordinary-failure', 'exit0-failure']) {
  const values = structuredClone(original); let code = 0;
  if (kind === 'missing') values.pop();
  if (kind === 'duplicate') values.push(values[1]);
  if (kind === 'stale') values[1].nonce = 'old';
  if (kind === 'wrong-manifest') values[1].manifest = 'other';
  if (kind === 'wrong-count') values[1].completedCount = 0;
  if (kind === 'unclosed') values[1].closed = false;
  if (kind === 'incomplete') values[1].complete = false;
  if (kind === 'missing-case') values.shift();
  if (kind === 'nonfinal') values.push({ stage: 'late' });
  if (['ordinary-failure', 'exit0-failure'].includes(kind)) { values[0].status = 'FAIL'; values[1].failures = 1; if (kind === 'ordinary-failure') code = 1; }
  const filename = path.join(ROOT, 'controls-work', `${kind}.json`);
  const { open } = await import('node:fs/promises'); const data = Buffer.from(values.map(value => JSON.stringify(value)).join('\n') + '\n');
  const file = await open(filename, 'wx'); await file.writeFile(data); await file.sync(); await file.close();
  const receipt = { reaped: true, timeout: false, overflow: false, signal: null, spawnError: null, code,
    logs: [{ artifactSha256: hash(data), artifactBytes: data.length, truncated: false }] };
  let admitted = false; let aggregateExit; let error;
  try {
    const final = await admitFinal({ expected, processReceipt: receipt, rawFile: filename, seen: new Set(), verify: async () => {}, capture: async () => {} });
    admitted = true; aggregateExit = final.failures || code !== 0 ? 1 : 0;
  } catch (caught) { error = caught.message; }
  assert.equal(admitted, ['valid', 'ordinary-failure', 'exit0-failure'].includes(kind));
  if (kind === 'valid') assert.equal(aggregateExit, 0);
  if (['ordinary-failure', 'exit0-failure'].includes(kind)) assert.equal(aggregateExit, 1);
  records.push({ kind, admitted, aggregateExit, error, rawSha256: hash(data) });
}
await durable(path.join(ROOT, 'CONTROLS.json'), { classification: 'SYNTHETIC_PARENT_RECEIPT_CONTROLS_NOT_PRODUCT', records, passed: records.length, failed: 0, children: 0 });
console.log(JSON.stringify({ syntheticParentControls: records.length, product: 0 }));
