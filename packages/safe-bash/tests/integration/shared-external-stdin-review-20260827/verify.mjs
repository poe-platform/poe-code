import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(join(here, path)));
const entries = {};
function visit(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), key = relative(here, path), stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, key);
    if (stat.isDirectory()) { entries[key + '/'] = 'directory'; visit(path); }
    else { assert.ok(stat.isFile(), key); if (key !== 'MANIFEST.json') entries[key] = hash(readFileSync(path)); }
  }
}
visit(here); assert.deepEqual(entries, json('MANIFEST.json').entries, 'Exact evidence inventory, including new entries');
const report = json('attempt-2/RESULT.json'), cases = json('attempt-2/CASES.json');
assert.equal(report.revision, 'eaed12f88365e69597994c4f2e6324a020202b66');
for (const [name, pin] of Object.entries(report.harness)) assert.equal(hash(readFileSync(join(here, name))), pin);
assert.deepEqual(report.caseCounts, { observations: 34, verified: 34, unexpected: 0, retainedDefectRows: 9 });
assert.deepEqual(cases.counts, report.caseCounts); assert.deepEqual(cases.unhandled, []);
assert.equal(cases.cases.filter(entry => entry.behaviorAccepted === false).length, 9);
assert.ok(cases.cases.every(entry => entry.observationVerified));
assert.deepEqual(report.unchangedCounts, { tests: 63, pass: 63, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.equal(report.originalColumn.status, 1); assert.equal(report.originalColumn.result.acceptance, 'HOLD');
assert.equal(report.cleaned, true); assert.equal(report.error, undefined); assert.equal(report.wholeGate, false); assert.equal(report.productEdits, false); assert.equal(report.privateAccess, false);
assert.equal(report.candidateInventoryUnchangedIncludingNewEntries, true);
assert.deepEqual(json('attempt-2/AFTER.json'), json('attempt-2/BUILT.json'));
assert.ok(report.commands.every(command => command.signal === null && command.error === null));
const source = Object.entries(report.source).filter(([, pin]) => pin.sha256);
const tree = execFileSync('git', ['--no-replace-objects', 'ls-tree', '-r', report.revision, '--', ...source.map(([path]) => path)], { cwd: repository, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const identifiers = new Map(tree.trim().split('\n').map(line => { const [header, path] = line.split('\t'); return [path, header.split(' ')[2]]; }));
const batch = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], { cwd: repository, input: source.map(([path]) => identifiers.get(path)).join('\n') + '\n', maxBuffer: 32 * 1024 * 1024 });
let offset = 0;
for (const [path, pin] of source) {
  const end = batch.indexOf(10, offset), header = batch.subarray(offset, end).toString().split(' '), size = Number(header[2]);
  assert.equal(header[0], identifiers.get(path)); assert.equal(header[1], 'blob'); assert.ok(Number.isSafeInteger(size));
  offset = end + 1; assert.equal(hash(batch.subarray(offset, offset + size)), pin.sha256, path); offset += size + 1;
}
assert.equal(offset, batch.length);
const built = json('attempt-2/BUILT.json');
for (const receipt of readFileSync(join(here, 'attempt-2/IMPORTS.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line))) {
  assert.equal(receipt.execPath, report.executable);
  if (receipt.path.endsWith('/probe.mjs')) assert.equal(receipt.sha256, report.harness['probe.mjs']);
  else { const key = relative(cases.candidate, receipt.path); assert.ok(key.startsWith('dist/')); assert.equal(receipt.sha256, built[key].sha256); }
}
const original = json('attempt-1/RESULT.json');
assert.equal(hash(readFileSync(join(here, 'attempt-1/run.mjs.txt'))), original.harness['run.mjs']);
assert.deepEqual(original.caseCounts, report.caseCounts);
assert.match(readFileSync(join(here, 'attempt-1/unchanged-contract-tests.stdout.txt'), 'utf8'), /tests 63[\s\S]*pass 63[\s\S]*fail 0/u);
console.log(JSON.stringify({ sealed: true, sourceFilesAuthenticated: source.length, reproducedObservations: 34, retainedDefectRows: 9, unchangedTests: 63, originalColumnHoldPreserved: true, newEntriesDetected: true }));
