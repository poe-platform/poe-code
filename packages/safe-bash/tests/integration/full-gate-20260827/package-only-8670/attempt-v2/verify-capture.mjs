import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = JSON.parse(readFileSync(join(here, 'CAPTURE.json')));
const expected = JSON.parse(readFileSync(join(here, 'RAW-MANIFEST.json')));
const summary = JSON.parse(readFileSync(join(here, 'SUMMARY.json')));
const scratch = mkdtempSync(join(tmpdir(), 'safe-bash-package-v2-review-'));
try {
  const payload = Buffer.from(readFileSync(join(here, 'raw-capture.tar.gz.b64'), 'utf8'), 'base64');
  assert.equal(hash(payload), capture.sha256); assert.equal(payload.length, capture.bytes);
  writeFileSync(join(scratch, 'capture.tar.gz'), payload);
  const directory = join(scratch, 'capture'); mkdirSync(directory);
  execFileSync('/usr/bin/tar', ['-xf', join(scratch, 'capture.tar.gz'), '-C', directory]);
  const actual = [];
  function walk(root, prefix = '') {
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name), local = prefix ? prefix + '/' + name : name, stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(path, local);
      else { assert.equal(stat.isFile(), true); const content = readFileSync(path); actual.push({ path: local, bytes: content.length, sha256: hash(content) }); }
    }
  }
  walk(directory); assert.deepEqual(actual, expected.files); assert.equal(actual.length, capture.files);
  const report = JSON.parse(readFileSync(join(directory, 'report.json')));
  const current = JSON.parse(readFileSync(join(directory, 'current-consumers/result.json')));
  for (const candidate of [capture.candidate, expected.candidate, summary.candidate, current.sourceCommit]) assert.equal(candidate, report.candidate);
  assert.equal(report.status, 'separate-package-cohort-passed-not-whole-gate');
  assert.equal(current.exitCode, 0);
  const groups = current.currentConsumers.groups;
  assert.equal(groups.length, 19); assert.ok(groups.every(group => group.compile === 'pass' && !group.error));
  const runtimes = groups.flatMap(group => group.runtimeResults);
  assert.equal(runtimes.length, 16); assert.ok(runtimes.every(runtime => runtime.status === 0));
  assert.deepEqual(runtimes.filter(runtime => runtime.counts).map(runtime => runtime.counts), [6, 13, 23].map(count => ({ tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 })));
  assert.deepEqual(current.currentConsumers.negativeTypes.map(group => [group.status, group.diagnostics]), [['pass', 1], ['pass', 2], ['pass', 5]]);
  assert.equal(report.public.count, 70); assert.equal(report.public.imports.length, 25);
  assert.equal(report.public.workflows.length, 4); assert.ok(report.public.workflows.every(result => result.exitCode === 0 && result.stderr === ''));
  assert.deepEqual(report.packageAfter, report.packageBefore); assert.equal(report.packageAfter.length, 710);
  assert.equal(report.buildReuse.files.length, 708); assert.deepEqual(report.dependencyChanges, []);
  assert.deepEqual(report.sourceChanges, []);
  for (const phase of report.phases) { assert.equal(phase.status, phase.expectedStatus); assert.equal(phase.clean, true); assert.deepEqual(phase.mixedNodeExecutables, []); assert.deepEqual(phase.sourceChanges, []); }
  assert.equal(report.fallbackControls.length, 4); assert.ok(report.fallbackControls.every(control => control.status === 'pass'));
  for (const [path, before] of Object.entries(report.bindingBefore)) assert.equal(report.bindingAfter[path].sha256, before.sha256);
  const artifact = JSON.parse(readFileSync(join(directory, 'pack.stdout.log')))[0];
  assert.equal(hash(readFileSync(join(directory, artifact.filename))), report.packageSha256);
  assert.equal(report.packageSha256, '96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1');
  const denied = JSON.parse(readFileSync(join(directory, 'current-consumers/current-consumer-source-denied.json')));
  assert.equal(denied.status, 1); assert.match(denied.stderr, /ERR_ACCESS_DENIED/); assert.ok(denied.stderr.includes(join(current.root, 'src/index.ts')));
  const external = report.externalVerifier;
  assert.equal(external.productRevision, report.candidate); assert.equal(external.verifierRevision, capture.verifierRevision);
  const inputs = JSON.parse(readFileSync(join(directory, 'archive-inputs.json')));
  let transformed = readFileSync(join(directory, 'external-verifier.mjs.txt'), 'utf8');
  assert.equal(hash(Buffer.from(transformed)), external.transformedSha256);
  for (const binding of external.helperBindings) { assert.equal(binding.sha256, inputs.files[binding.path].sha256); transformed = transformed.replace(JSON.stringify(binding.replacement), JSON.stringify(binding.specifier)); }
  assert.equal(hash(Buffer.from(transformed)), external.originalSha256);
  assert.equal(hash(readFileSync(join(directory, 'external-driver.mjs.txt'))), external.driverSha256);
  assert.equal(report.temporaryRemoved, true);
  console.log(JSON.stringify({ candidate: report.candidate, verifier: external.verifierRevision, files: actual.length, strictGroups: 19, runtimeGroups: 16, publicNames: 70, packageSha256: report.packageSha256, productExecutions: 0, status: report.status }));
} finally {
  rmSync(scratch, { recursive: true, force: true }); assert.equal(existsSync(scratch), false);
}
