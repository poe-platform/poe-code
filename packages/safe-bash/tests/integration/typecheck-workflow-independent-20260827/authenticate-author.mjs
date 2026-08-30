import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidenceCommit = '547160e8a81d07a7f78de3092321c217e51c5f3c';
const candidate = 'b9559de5c62fb679c8558fc2444ecb99f1d9eee1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const manifestPath = 'tests/integration/typecheck-workflow-repair/evidence/manifest.json';
const manifestBytes = committed(evidenceCommit, manifestPath), manifest = JSON.parse(manifestBytes);
assert.equal(manifest.sourceCommit, candidate);
assert.equal(sha256(committed(candidate, manifest.harness.path)), manifest.harness.sha256);
const result = { evidenceCommit, candidate, manifestSha256: sha256(manifestBytes), qualification: 'Authentication of original author evidence, not independent rerun of its fifteen checks or runtime acceptance.', attempts: [], captures: 0 };
for (const attempt of manifest.attempts) {
  const bytes = committed(evidenceCommit, attempt.path);
  assert.equal(sha256(bytes), attempt.sha256);
  const bundle = JSON.parse(bytes), files = new Map();
  for (const entry of bundle.files) {
    assert.equal(files.has(entry.path), false);
    const raw = gunzipSync(Buffer.from(entry.gzipBase64.join(''), 'base64'));
    assert.equal(raw.length, entry.bytes); assert.equal(sha256(raw), entry.sha256);
    files.set(entry.path, JSON.parse(raw)); result.captures++;
  }
  const report = files.get('report.json'), combined = files.get('combined/report.json');
  assert.equal(report.candidate, attempt.candidate);
  assert.equal(report.archiveSha256, attempt.archiveSha256);
  assert.equal(report.cleaned, true); assert.equal(report.passed, true);
  assert.equal(report.checks.length, attempt.checks);
  assert.ok(report.checks.every(check => check.status === 'pass'));
  assert.equal(combined.phases.length, attempt.phaseCount);
  assert.equal(combined.builds, 1); assert.equal(combined.runtimeExecutions, 0);
  assert.equal(combined.consumers.groups.length, 19);
  assert.deepEqual(combined.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]);
  if (attempt.name === 'v3') {
    for (const entry of [...report.overlay, ...report.protectedInputs]) assert.equal(sha256(committed(candidate, entry.path)), entry.sha256, entry.path);
    assert.equal(execFileSync('git', ['--no-replace-objects', 'diff', '--name-only', attempt.candidate, candidate, '--', 'src', 'package-lock.json'], { cwd: root, encoding: 'utf8' }), '');
    assert.equal(combined.sourceConsumers.groups.length, 3);
    assert.equal(combined.sourceConsumers.passed, true);
  }
  result.attempts.push({ name: attempt.name, captures: files.size, originalCandidate: attempt.candidate, originalChecks: report.checks.length, originalPassed: report.passed, overlayPaths: report.overlay.map(entry => entry.path) });
}
assert.equal(result.captures, 33);
const bytes = JSON.stringify(result, null, 2) + '\n';
if (process.argv[2]) { assert.equal(existsSync(process.argv[2]), false); writeFileSync(process.argv[2], bytes); }
console.log(bytes);
