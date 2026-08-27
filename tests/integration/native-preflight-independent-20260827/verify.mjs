import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('./', import.meta.url)), repository = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = '4d0507cd3439d5e4dea60ae20d023d3fcb9662f1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitFile = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const walk = (prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => { const path = join(prefix, name); assert.equal(lstatSync(join(root, path)).isSymbolicLink(), false); return lstatSync(join(root, path)).isDirectory() ? walk(path) : [path]; });
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.deepEqual(walk().filter(path => path !== 'MANIFEST.json'), manifest.files.map(entry => entry.path));
for (const entry of manifest.files) { const bytes = readFileSync(join(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); }
const helper = 'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs';
assert.deepEqual(gitFile(candidate, helper), gitFile('21049bed', helper));
assert.deepEqual(gitFile(candidate, 'scripts/verify-whole-gate.mjs'), gitFile('3ee476a8', 'scripts/verify-whole-gate.mjs'));
for (const path of [helper, 'scripts/verify-whole-gate.mjs', 'package.json']) assert.deepEqual(gitFile(candidate, path), gitFile('a01310c5', path));
let captures = 0;
const attempts = {};
for (const name of ['first', 'final']) {
  const directory = join(root, 'evidence', name), report = JSON.parse(readFileSync(join(directory, 'report.json'))), files = new Map();
  assert.equal(report.candidate, candidate); assert.equal(report.setupFailure, undefined); assert.equal(report.cleaned, true); assert.equal(report.wholeSuiteLaunched, false); assert.equal(report.originalsUnchanged, true);
  assert.equal(report.harnessSha256, hash(readFileSync(join(root, name === 'first' ? 'evidence/first/audit.mjs.data' : 'audit.mjs'))));
  for (const entry of report.captures) { const bytes = gunzipSync(Buffer.from(readFileSync(join(directory, entry.path), 'utf8'), 'base64')); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); assert.equal(files.has(entry.path), false); files.set(entry.path, bytes); captures++; }
  for (const entry of report.sourceInputs) assert.equal(hash(gitFile(candidate, entry.path)), entry.sha256);
  assert.equal(report.nativeAvailability.assets.length, 49); assert.deepEqual(report.nativeAvailability.issues, []); assert.equal(report.nativeAvailability.assets.filter(asset => asset.executable).length, 42);
  assert.match(files.get('author26.stdout.gz.base64').toString(), /# tests 26\b/u); assert.match(files.get('author26.stdout.gz.base64').toString(), /# pass 26\b/u); assert.match(files.get('author26.stdout.gz.base64').toString(), /# skipped 0\b/u);
  for (const command of report.commands) { assert.equal(command.signal, null); assert.equal(command.error, undefined); }
  assert.equal(report.mutants.length, 2); assert.ok(report.mutants.every(mutant => mutant.forbiddenImport && mutant.rejectedByNoImportControl));
  assert.deepEqual(report.scheduling.map(({ name, peak, status }) => ({ name, peak, status })), [{ name: 'current-first', peak: 2, status: 0 }, { name: 'current-repeat', peak: 2, status: 0 }, { name: 'old-order-mutant', peak: 6, status: 0 }, { name: 'unknown-option', peak: 0, status: 9 }, { name: 'name-filter', peak: 1, status: 0 }]);
  if (name === 'first') {
    assert.deepEqual(report.counts, { pass: 144, fail: 4, skip: 0 }); assert.ok(report.checks.filter(check => check.status === 'fail').every(check => /EACCES/u.test(check.error)));
  } else {
    assert.deepEqual(report.counts, { pass: 148, fail: 0, skip: 0 }); assert.equal(report.nativeNegatives.length, 140); assert.equal(report.stagedTargets, 34);
    const keys = new Set();
    for (const entry of report.nativeNegatives) {
      const key = `${entry.index}:${entry.fault}`; assert.equal(keys.has(key), false); keys.add(key);
      assert.deepEqual(entry.results, [{ route: 'preflight', status: 78 }, { route: 'execute', status: 78 }]);
      for (const route of ['preflight', 'execute']) {
        const raw = JSON.parse(files.get(`native-${entry.index}-${entry.fault}-${route}.stdout.gz.base64`));
        assert.equal(raw.issues.length, 1); assert.equal(raw.issues[0].kind, 'native-unavailable-or-mismatched'); assert.equal(raw.suiteLaunched, false);
      }
    }
    for (const [index, asset] of report.nativeAvailability.assets.entries()) { assert.ok(keys.has(`${index}:missing`)); assert.ok(keys.has(`${index}:changed`)); assert.equal(keys.has(`${index}:nonexecutable`), asset.executable); }
  }
  attempts[name] = report.counts;
}
console.log(JSON.stringify({ candidate, evidenceAuthenticated: true, boundedNativeGuardsAccepted: true, attempts, authenticatedNativeAssets: 49, publicNegativeRoutes: 280, unchangedAuthorControls: 26, nativeGuardMutants: 2, schedulingMutants: 1, rawCaptures: captures, wholeSuiteLaunched: false, successorPolicyAdmitted: false }, null, 2));
