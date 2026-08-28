import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { own, repository, candidate, digest, git, snapshot } from './audit.mjs';
import { supervise } from '../../breadth-continuation-20260828/executor-v4/supervisor.mjs';

const commit = process.argv[2];
assert(/^[0-9a-f]{40}$/.test(commit ?? ''));
const presealBytes = fs.readFileSync(path.join(own, 'CORRECTION-PRESEAL.json'));
const preseal = JSON.parse(presealBytes);
function authenticate() {
  for (const entry of [...preseal.files, { path: 'CORRECTION-PRESEAL.json', sha256: digest(presealBytes) }]) {
    const filename = path.join(own, entry.path);
    const bytes = fs.readFileSync(filename);
    assert.equal(digest(bytes), entry.sha256);
    assert(bytes.equals(git(['show', `${commit}:${path.relative(repository, filename)}`])));
  }
}
authenticate();
const before = snapshot();
const work = path.join(own, 'capture-02');
fs.mkdirSync(work);
const save = (name, value) => fs.writeFileSync(path.join(work, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
save('INPUTS-BEFORE.json', before);
const node = JSON.parse(fs.readFileSync(path.join(candidate, '../executor-v3/PROJECTION.json'))).tools.find(tool => tool.role === 'node');
assert.equal(process.execPath, node.path);
assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
const expectations = JSON.parse(fs.readFileSync(path.join(own, 'CORRECTION-EXPECTATIONS.json')));
const rows = [];
let unsafe = false;
for (const specimen of expectations.cases) {
  if (unsafe) { rows.push({ id: specimen.id, status: 'UNRUN_UNSAFE_TAIL' }); continue; }
  const receipt = await supervise(node.path, ['--unhandled-rejections=strict', '--max-old-space-size=64', path.join(own, 'correction-worker.mjs'), specimen.id], own, { deadline: 10000 });
  save(`${specimen.id}.json`, receipt);
  const report = receipt.records.at(-1)?.report;
  const safe = receipt.natural && receipt.reaped && receipt.stdout === '' && receipt.stderr === '' && report;
  rows.push({ id: specimen.id, pid: receipt.pid, reaped: receipt.reaped, status: safe ? report.pass ? 'PASS' : 'FINDING' : 'UNSAFE_STOP', actualCode: report?.caught?.code ?? null, evaluations: report?.evaluations ?? [], importAttempted: report?.importAttempted ?? false });
  unsafe ||= !safe;
}
authenticate();
const after = snapshot();
save('INPUTS-AFTER.json', after);
assert.deepEqual(before.files, after.files);
assert.deepEqual(before.namespace, after.namespace);
const result = { kind: 'FOCUSED_CORRECTED_FORWARDING_NOT_REPLACEMENT_SCORE', presealCommit: commit, presealSha256: digest(presealBytes), rows, passed: rows.filter(row => row.status === 'PASS').length, childrenReaped: rows.filter(row => row.reaped).length, unsafe, sourceStable: true, supervisorPid: process.pid, originalCaptureRetained: true, productImports: 0, comparatorImports: 0, admissionAttempts: 0, grantsMinted: 0 };
save('RESULT.json', result);
console.log(JSON.stringify(result));
if (unsafe || result.passed !== expectations.cases.length) process.exitCode = 1;
