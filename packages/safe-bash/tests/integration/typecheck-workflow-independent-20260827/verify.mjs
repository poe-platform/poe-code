import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('./', import.meta.url));
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = 'b9559de5c62fb679c8558fc2444ecb99f1d9eee1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = (prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => {
  const path = join(prefix, name);
  assert.equal(lstatSync(join(root, path)).isSymbolicLink(), false);
  return lstatSync(join(root, path)).isDirectory() ? walk(path) : [path];
});
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.deepEqual(walk().filter(path => path !== 'MANIFEST.json'), manifest.files.map(entry => entry.path));
for (const entry of manifest.files) {
  const bytes = readFileSync(join(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256, entry.path);
}
let authenticatedCaptures = 0;
const reports = {};
for (const attempt of ['first', 'final']) {
  const directory = join(root, 'evidence', attempt);
  const report = JSON.parse(readFileSync(join(directory, 'report.json')));
  assert.equal(report.candidate, candidate); assert.equal(report.cleaned, true); assert.equal(report.setupFailure, undefined);
  assert.deepEqual(report.counts, attempt === 'first' ? { pass: 19, fail: 2, skip: 0 } : { pass: 20, fail: 1, skip: 0 });
  const files = new Map();
  for (const entry of report.captures) {
    assert.equal(files.has(entry.path), false);
    const bytes = gunzipSync(Buffer.from(readFileSync(join(directory, entry.path), 'utf8'), 'base64'));
    assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256); files.set(entry.path, bytes); authenticatedCaptures++;
  }
  const json = name => JSON.parse(files.get(`${name}.gz.base64`));
  assert.deepEqual(json('source-before'), json('source-after'));
  assert.equal(json('source-before').length, 22001); assert.equal(json('tools').length, 318); assert.equal(json('emitted').length, 708);
  assert.ok(json('tools').every(entry => entry.kind === 'regular'));
  for (const record of report.commands) { assert.equal(record.signal, null); assert.equal(record.error, undefined); }
  const cold = json('cold.report'), combined = json('combined.report');
  assert.equal(cold.phases.length, 0); assert.equal(cold.builds, 0);
  assert.equal(cold.status, 'build-prerequisite-required');
  assert.equal(report.commands.find(command => command.label === 'cold').status, 78);
  assert.equal(combined.status, 'typecheck-passed-not-runtime-acceptance');
  assert.equal(combined.builds, 1); assert.equal(combined.phases.length, 28);
  assert.equal(combined.sourceConsumers.groups.length, 3); assert.equal(combined.sourceConsumers.passed, true);
  assert.equal(combined.consumers.groups.length, 19); assert.equal(combined.consumers.passed, true);
  assert.deepEqual(combined.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]);
  assert.equal(combined.runtimeExecutions, 0);
  let publicResolutions = 0;
  for (const phase of combined.phases.filter(phase => phase.label.startsWith('consumer-'))) {
    const successes = [...phase.stdout.matchAll(/Module name '(virtual-bash(?:\/[^']*)?)' was successfully resolved to '([^']+)'/gu)];
    assert.ok(successes.length > 0, phase.label);
    for (const match of successes) assert.match(match[2], /\/consumer\/(?:[^/]+\/)?node_modules\/virtual-bash\/dist\//u);
    publicResolutions += successes.length;
  }
  assert.equal(json('moved-consumer-negative.report').phases[0].status, 2);
  assert.match(json('moved-consumer-negative.report').phases[0].stdout, /TS2305/u);
  assert.equal(json('foreign-build-resolution.report').result.passed, true);
  assert.equal(report.bindingMutation.status, 0);
  assert.ok(report.bindingMutation.resolutions.some(entry => entry.specifier === 'virtual-bash/contracts' && entry.resolved.includes('/decoy-dist/')));
  assert.match(files.get('coverage-controls.stdout.gz.base64').toString(), /# pass 24\b/u);
  if (attempt === 'final') {
    assert.equal(report.harnessSha256, sha256(readFileSync(join(root, 'audit.mjs'))));
    const full = json('foreign-build-resolution-full.report');
    assert.equal(full.status, 'typecheck-passed-not-runtime-acceptance'); assert.equal(full.consumers.passed, true);
    assert.equal(report.bindingMutation.fullWorkflow.status, 0); assert.equal(full.sourceConsumers.passed, true);
    assert.equal(full.consumers.groups.length, 19); assert.equal(full.phases.length, 27);
    const sources = new Map(json('source-before').map(entry => [entry.path, entry]));
    for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'scripts/typecheck.mjs', 'scripts/typecheck-inputs.mjs', 'scripts/typecheck-consumers.mjs', 'scripts/verify-current-consumers.mjs', 'tests/plugins/qualified-current-release/consumers.mjs', 'tests/plugins/qualified-current-release/inventory.json', 'tests/plugins/qualified-current-release/captured-types.json']) {
      const bytes = execFileSync('git', ['--no-replace-objects', 'show', `${candidate}:${path}`], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
      assert.equal(sha256(bytes), sources.get(path).sha256, path);
    }
  }
  reports[attempt] = { ...report.counts, publicResolutions, compilerPhases: combined.phases.length, cleaned: report.cleaned };
}
assert.equal(reports.first.publicResolutions, reports.final.publicResolutions);
const author = JSON.parse(readFileSync(join(root, 'evidence/author-authentication.json')));
assert.equal(author.captures, 33); assert.equal(author.candidate, candidate);
console.log(JSON.stringify({ evidenceAuthenticated: true, candidate, independentAuditAccepted: false, unresolvedGuard: 'mixed-public-package-resolution', attempts: reports, rawCaptures: authenticatedCaptures, authorCapturesSeparatelyAuthenticated: author.captures, runtimeAcceptance: false }, null, 2));
