import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { work, candidate, hash, write, save, inventory, run } from './harness.mjs';

const source = path.join(work, 'source');
const packed = JSON.parse(fs.readFileSync(path.join(work, 'PACKAGE.json')));
const root = path.join(work, 'holdout-consumer');
assert(!fs.existsSync(root));
fs.mkdirSync(root);
fs.cpSync(packed.product, path.join(root, 'node_modules/virtual-bash'), { recursive: true, dereference: true });
write(path.join(root, 'package.json'), '{"type":"module","private":true}\n');
const original = path.join(source, 'tests/integration/owned-output-production-independent-20260827');
const inputs = {};
for (const name of ['CASES.json', 'assert-observation.mjs', 'candidate-v1/run-case.mjs', 'candidate-v1/core-cases.mjs', 'candidate-v1/network-cases.mjs', 'candidate-v1/audit-loader.mjs']) {
  const bytes = fs.readFileSync(path.join(original, name));
  inputs[name] = hash(bytes);
  write(path.join(root, path.basename(name)), bytes);
}
const state = path.join(work, 'holdout-binding.json');
save(state, { consumer: fs.realpathSync(root), installed: Object.fromEntries(Object.entries(packed.installed).filter(([,value]) => value.kind === 'file').map(([name,value]) => [name,value.sha256])) });
const before = inventory(root);
const rows = [];
for (const control of JSON.parse(fs.readFileSync(path.join(root, 'CASES.json'))).cases) rows.push(await run(`holdout-${control.id}`, [process.execPath, '--experimental-loader', path.join(root, 'audit-loader.mjs'), path.join(root, 'run-case.mjs'), control.id], root, { timeout: 15000, maxBytes: 2 * 1024 * 1024, env: { REVIEW_STATE: state, REVIEW_TRACE: path.join(work, `holdout-${control.id}.jsonl`) } }));
assert.deepEqual(inventory(root), before);
save(path.join(work, 'HOLDOUTS.json'), { candidate, inputs, rows, unchangedIncludingNewEntries: true, qualification: 'Independent execution of existing unchanged independent owned-output holdouts; counts overlap other suites.' });
if (rows.some(row => row.status !== 0)) process.exitCode = 1;
