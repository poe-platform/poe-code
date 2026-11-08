import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('./', import.meta.url)), repository = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = 'a01310c5571dfda2aae4c6c8cc185e2530a01e89';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitFile = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const walk = (prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => { const path = join(prefix, name); assert.equal(lstatSync(join(root, path)).isSymbolicLink(), false); return lstatSync(join(root, path)).isDirectory() ? walk(path) : [path]; });
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.deepEqual(walk().filter(path => path !== 'MANIFEST.json'), manifest.files.map(entry => entry.path));
for (const entry of manifest.files) { const bytes = readFileSync(join(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, entry.path); }
const original = gitFile('31e24055e1123462dfd2539f107c0a3abf2b66ed', 'tests/integration/typecheck-workflow-independent-20260827/audit.mjs').toString();
assert.equal(readFileSync(join(root, 'unchanged-cohort.mjs'), 'utf8'), original.replace("const candidate = 'b9559de5c62fb679c8558fc2444ecb99f1d9eee1';", `const candidate = '${candidate}';`));
let captures = 0;
const observations = {};
for (const attempt of ['unchanged', 'nearby']) {
  const directory = join(root, 'evidence', attempt), report = JSON.parse(readFileSync(join(directory, 'report.json'))), files = new Map();
  assert.equal(report.candidate, candidate); assert.equal(report.cleaned, true); assert.equal(report.setupFailure, undefined);
  assert.equal(report.harnessSha256, hash(readFileSync(join(root, attempt === 'unchanged' ? 'unchanged-cohort.mjs' : 'nearby.mjs'))));
  for (const entry of report.captures) { const bytes = gunzipSync(Buffer.from(readFileSync(join(directory, entry.path), 'utf8'), 'base64')); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); assert.equal(files.has(entry.path), false); files.set(entry.path, bytes); captures++; }
  const json = name => JSON.parse(files.get(`${name}.gz.base64`));
  assert.deepEqual(json('source-before'), json('source-after')); assert.equal(json('source-before').length, 22745); assert.equal(json('tools').length, 318); assert.equal(json('emitted').length, 708);
  for (const command of report.commands) { assert.equal(command.error, undefined); assert.equal(command.signal, null); }
  const combined = json('combined.report');
  assert.equal(combined.status, 'typecheck-passed-not-runtime-acceptance'); assert.equal(combined.builds, 1); assert.equal(combined.phases.length, 28);
  assert.equal(combined.candidateBinding.metadataSha256, hash(gitFile(candidate, 'package.json'))); assert.equal(combined.candidateBinding.declarations.length, 177);
  assert.equal(combined.sourceConsumers.passed, true); assert.equal(combined.sourceConsumers.groups.length, 3);
  assert.equal(combined.consumers.passed, true); assert.equal(combined.consumers.groups.length, 19); assert.equal(combined.runtimeExecutions, 0);
  assert.deepEqual(combined.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]);
  if (attempt === 'unchanged') {
    assert.deepEqual(report.counts, { pass: 20, fail: 1, skip: 0 });
    const failed = report.checks.filter(check => check.status === 'fail'); assert.equal(failed.length, 1); assert.equal(failed[0].name, 'source-consumer-package-resolution-rejects-repository-src'); assert.match(failed[0].error, /candidate build/u);
    const fallback = json('source-fallback-negative.report'); assert.equal(fallback.phases[0].status, 0); assert.equal(fallback.result.passed, false); assert.match(fallback.result.groups[0].error, /foreign candidate declaration\/source fallback/u);
    assert.equal(json('foreign-build-resolution.report').result.passed, false); assert.equal(report.bindingMutation.status, 2);
    assert.match(files.get('coverage-controls.stdout.gz.base64').toString(), /# pass 24\b/u);
  } else {
    assert.deepEqual(report.counts, { pass: 6, fail: 0, skip: 0 }); assert.equal(report.neighbors.length, 11); assert.ok(report.neighbors.every(check => check.status === 'pass'));
    assert.equal(report.neighborDriverSha256, hash(readFileSync(join(root, 'binding-cases.mjs'))));
    const warm = json('mixed-full-warm.report'); assert.equal(warm.status, 'typecheck-failed'); assert.equal(warm.builds, 0); assert.equal(warm.phases.length, 26); assert.equal(warm.sourceConsumers.passed, true);
    const rejected = warm.consumers.groups.filter(group => group.status === 'fail'); assert.equal(rejected.length, 1); assert.equal(rejected[0].name, 'env-split-public-types');
    assert.equal(warm.phases.find(phase => phase.label === 'consumer-env-split-public-types').status, 0);
    assert.equal(report.mixedWarm.status, 2); assert.equal(report.guardMutant.killedByOriginalStatus2Assertion, true); assert.equal(json('mixed-binding-mutant.report').result.passed, true);
  }
  observations[attempt] = report.counts;
}
const authorBytes = gitFile('0ebba13251e5af5ec97db2f66f0eba0aa5605f93', 'tests/integration/typecheck-workflow-repair/binding-followup/evidence.json');
const author = JSON.parse(authorBytes); assert.equal(author.sourceCommit, candidate); const authorFiles = new Map();
for (const entry of author.captures) { const bytes = gunzipSync(Buffer.from(entry.gzipBase64.join(''), 'base64')); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); authorFiles.set(entry.path, JSON.parse(bytes)); }
assert.equal(authorFiles.size, 12); const authorReport = authorFiles.get('report.json'); assert.equal(authorReport.checks.length, 22); assert.equal(authorReport.passed, true);
for (const entry of [...authorReport.overlay, ...authorReport.protectedInputs]) assert.equal(hash(gitFile(candidate, entry.path)), entry.sha256);
console.log(JSON.stringify({ candidate, evidenceAuthenticated: true, mixedBindingDefectClosed: true, unchangedCohortGreen: false, remainingExactFailure: 'diagnostic wording only; source fallback still rejected', observations, nearbyCompilerControls: 11, killedBindingMutants: 1, authenticatedRawCaptures: captures, authorCapturesSeparate: authorFiles.size, wholeProductAcceptance: false }, null, 2));
