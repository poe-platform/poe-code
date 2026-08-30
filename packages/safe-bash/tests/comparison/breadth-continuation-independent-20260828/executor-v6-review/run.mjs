import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { own, repository, candidate, digest, git, snapshot } from './audit.mjs';
import { supervise } from '../../breadth-continuation-20260828/executor-v4/supervisor.mjs';

const sourceCommit = process.argv[2];
assert(/^[0-9a-f]{40}$/.test(sourceCommit ?? ''));
assert(process.execArgv.includes('--unhandled-rejections=strict'));
const presealBytes = fs.readFileSync(path.join(own, 'PRESEAL.json'));
const preseal = JSON.parse(presealBytes);
function authenticateOwn() {
  for (const entry of [...preseal.sources, { path: 'PRESEAL.json', sha256: digest(presealBytes) }]) {
    const filename = path.join(own, entry.path);
    const bytes = fs.readFileSync(filename);
    assert.equal(digest(bytes), entry.sha256);
    assert(bytes.equals(git(['show', `${sourceCommit}:${path.relative(repository, filename)}`])));
  }
}
authenticateOwn();
const before = snapshot();
const runRoot = path.join(own, 'capture-01');
fs.mkdirSync(runRoot);
const save = (name, value) => fs.writeFileSync(path.join(runRoot, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
save('INPUTS-BEFORE.json', before);
const projection = JSON.parse(fs.readFileSync(path.join(candidate, '../executor-v3/PROJECTION.json')));
const node = projection.tools.find(tool => tool.role === 'node');
assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
assert.equal(process.execPath, node.path);
const original = JSON.parse(fs.readFileSync(path.join(own, '../executor-v5-review/EXPECTATIONS.json')));
const expectations = JSON.parse(fs.readFileSync(path.join(own, 'EXPECTATIONS.json')));
const inputs = [...original.cases.map(row => ({ id: row.id, cohort: 'original15' })), ...expectations.supplementalImports.map(row => ({ id: row.id, cohort: 'supplementalImports' })), { id: 'data', cohort: 'helperChild' }];
assert.equal(inputs.length, expectations.limits.children);
const rows = [];
let unsafe = false;
for (const input of inputs) {
  if (unsafe) { rows.push({ ...input, status: 'UNRUN_UNSAFE_TAIL' }); continue; }
  const receipt = await supervise(node.path, ['--unhandled-rejections=strict', '--max-old-space-size=64', path.join(own, input.id === 'data' ? 'data.mjs' : 'worker.mjs'), input.id], own, { deadline: 10000 });
  save(`${input.id}.json`, receipt);
  const report = receipt.records.at(-1)?.report;
  const safe = receipt.natural && receipt.reaped && receipt.stderr === '' && receipt.stdout === '' && report;
  rows.push({ ...input, status: safe ? report.pass ? 'PASS' : 'FINDING' : 'UNSAFE_STOP', pass: safe && report.pass === true, pid: receipt.pid, reaped: receipt.reaped, importAttempted: report?.importAttempted ?? false, evaluations: report?.evaluations ?? [], expectedCode: expectations.codes[input.id] ?? expectations.supplementalImports.find(row => row.id === input.id)?.expectedCode ?? null, actualCode: report?.caught?.code ?? null, helpers: report?.rows ?? null });
  unsafe ||= !safe;
}
authenticateOwn();
const after = snapshot();
save('INPUTS-AFTER.json', after);
assert.deepEqual(after.files, before.files);
assert.deepEqual(after.namespace, before.namespace);
const count = cohort => ({ passed: rows.filter(row => row.cohort === cohort && row.status === 'PASS').length, findings: rows.filter(row => row.cohort === cohort && row.status === 'FINDING').length, unsafe: rows.filter(row => row.cohort === cohort && row.status === 'UNSAFE_STOP').length, unrun: rows.filter(row => row.cohort === cohort && row.status === 'UNRUN_UNSAFE_TAIL').length });
const result = { kind: 'INDEPENDENT_ACTUAL_V6_BODY_PREEXECUTION_ONLY', sourceCommit, presealSha256: digest(presealBytes), sourceStable: true, candidateInputs: before.files.length, node, supervisorPid: process.pid, rows, counts: { original15: count('original15'), supplementalImports: count('supplementalImports'), helperChild: count('helperChild') }, childrenPlanned: inputs.length, childrenReaped: rows.filter(row => row.reaped).length, actualImportAttempts: rows.filter(row => row.importAttempted).length, actualEvaluations: rows.reduce((total, row) => total + (row.evaluations?.length ?? 0), 0), refusals: rows.filter(row => row.actualCode).length, unsafe, productImports: 0, comparatorImports: 0, C11: 0, archiveStaging: 0, grantsGenerated: 0 };
save('RESULT.json', result);
console.log(JSON.stringify({ counts: result.counts, reaped: result.childrenReaped, evaluations: result.actualEvaluations, refusals: result.refusals, unsafe }));
if (unsafe || rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
