import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(here, path));
const reports = [1, 2, 3].map(attempt => JSON.parse(read(`attempt-${attempt}/RESULT.json`)));
assert.deepEqual(reports.map(report => report.executions.length), [9, 10, 19]);
assert.ok(reports.every(report => report.cleaned && !report.privateAccess && !report.wholeGateLaunched && report.builds === 0));
assert.match(reports[0].error.message, /false !== true/u);
assert.match(reports[1].error.message, /lower\.trace/u);
const final = reports[2]; assert.equal(final.error, undefined);
assert.equal(final.originalNode.version, 'v22.22.2'); assert.equal(final.alternateNode.version, 'v24.11.1');
for (const [index, report] of reports.entries()) {
  for (const entry of report.executions) {
    assert.equal(entry.signal, null); assert.equal(entry.error, null);
    for (const channel of ['stdout', 'stderr']) assert.equal(hash(read(`attempt-${index + 1}/${entry.label}.${channel}.log`)), entry[`${channel}Sha256`]);
  }
  const serial = report.executions.filter(entry => /^serial-[1-4]$/u.test(entry.label)); assert.equal(serial.length, 4); assert.ok(serial.every(entry => entry.status === 1 && entry.hasNullSourceFailure));
}
for (const entry of final.executions.filter(entry => /^traced-entry-/u.test(entry.label))) {
  assert.equal(entry.status, 1); assert.ok(entry.trace.some(row => row.url.endsWith('/typescript/lib/typescript.js') && row.format === 'commonjs' && row.source === 'null'));
}
assert.equal(final.executions.filter(entry => /^node24-entry-/u.test(entry.label) && entry.status === 0).length, 4);
assert.equal(final.executions.find(entry => entry.label === 'node24-plain-commonjs').status, 0);
assert.equal(Object.keys(final.source).length, 529); assert.equal(Object.keys(final.tools).length, 314);
for (const key of ['internal/modules/customization_hooks', 'internal/modules/esm/loader', 'internal/modules/esm/load']) assert.equal(hash(read(`attempt-3/node22-${key.split('/').at(-1)}.js.txt`)), final[key].sha256);
const guard = execFileSync('git', ['--no-replace-objects', 'show', `${final.evidenceCommit}:tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs`], { cwd: repository, timeout: 10000 }); assert.equal(hash(guard), final.guardSha256);
const inventory = {};
function walk(prefix = '') {
  for (const entry of readdirSync(join(here, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name; assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) walk(path);
    else if (path !== 'MANIFEST.json') { const bytes = read(path); inventory[path] = { bytes: bytes.length, sha256: hash(bytes) }; }
  }
}
walk();
if (process.argv[2] === '--seal') { assert.equal(existsSync(join(here, 'MANIFEST.json')), false); writeFileSync(join(here, 'MANIFEST.json'), JSON.stringify({ candidate: final.candidate, evidenceCommit: final.evidenceCommit, files: inventory }, null, 2) + '\n', { flag: 'wx' }); }
else assert.deepEqual(JSON.parse(read('MANIFEST.json')).files, inventory);
console.log(JSON.stringify({ originalBootstrapFailuresReproduced: 4, tracedCommonJsNullFailures: 4, alternateRuntimeBootstrapSuccessesNotFeaturePasses: 4, finalDiagnosticChildren: 19, retainedChildrenAcrossAttempts: 38, candidateFiles: 529, frozenTools: 314, productRepairs: 0, wholeGate: false, privateAccess: false }));
