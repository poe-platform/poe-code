import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = path => JSON.parse(readFileSync(join(here, path)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = read('expected-inputs.json');
const current = read('evidence-attempt-02/canonical-reports.json');
const mutant = read('evidence-attempt-02/mutant-reports.json');
const manifest = read('evidence-attempt-02/canonical-manifest.json');
assert.deepEqual(read('evidence-attempt-02/candidate-before.json'), expected.files);
assert.deepEqual(read('evidence-attempt-02/candidate-after.json'), expected.files);
assert.deepEqual(read('evidence-attempt-02/emitted-before.json'), manifest.emittedHashes);
assert.deepEqual(read('evidence-attempt-02/emitted-after.json'), manifest.emittedHashes);
assert.deepEqual(read('readonly-before.json'), read('evidence-attempt-02/readonly-after.json'));
assert.deepEqual(read('tools-before.json'), read('evidence-attempt-02/tools-after.json'));
assert.equal(current.length, 10);
assert.equal(mutant.length, 10);
for (const { child, report } of current) {
  assert.equal(child.status, 0);
  assert.equal(report.passed, true);
  assert.equal(report.liveWorkers, 0);
  assert.deepEqual(report.unhandled, []);
}
for (const { child, report } of mutant) {
  assert.equal(child.status, 1);
  assert.equal(report.sourcePinned, true);
  assert.match(report.failure.message, /^(exec-settled|exec-rejected|exec-rejected-owned): worker 1 has not exited/);
  assert.deepEqual(report.unhandled, []);
}
const pids = [...new Set([
  ...read('evidence/children.json').map(child => child.pid),
  ...read('evidence-attempt-02/children.json').map(child => child.pid),
  ...current.map(({ child }) => child.pid),
  ...mutant.map(({ child }) => child.pid),
])];
const processChecks = pids.map(pid => {
  assert.ok(Number.isInteger(pid) && pid > 0);
  let absent = false;
  try { process.kill(pid, 0); } catch (error) {
    assert.equal(error.code, 'ESRCH');
    absent = true;
  }
  assert.equal(absent, true, `Previously owned child PID still present: ${pid}; do not kill an unconfirmed reused PID`);
  return { pid, absent: true };
});
for (const path of ['.work', '.work-attempt-02', '.tool-forensic-copy']) assert.equal(existsSync(join(here, path)), false);
const verification = {
  time: new Date().toISOString(), candidate: expected.revision, sourceAndEmittedBeforeAfterEqual: true,
  sourceInputs: Object.keys(expected.files).length, emittedFiles: Object.keys(manifest.emittedHashes).length,
  canonicalReports: current.length, genuineRetirementMutantReports: mutant.length,
  canonicalManifestCompactSha256: digest(JSON.stringify(manifest)),
  historicalAndAuthorEvidenceUnchanged: true, toolBytesUnchanged: true,
  processChecks, checksUseSignalZeroOnly: true, noScratchRemains: true,
};
writeFileSync(join(here, 'VERIFICATION.json'), `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' });
function inventory(directory) {
  const records = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) records.push(...inventory(path));
    else records.push({ path: relative(here, path), bytes: stat.size, sha256: digest(readFileSync(path)) });
  }
  return records;
}
const files = inventory(here);
assert.ok(!files.some(entry => entry.path === 'EVIDENCE_MANIFEST.json'));
writeFileSync(join(here, 'EVIDENCE_MANIFEST.json'), `${JSON.stringify({ candidate: expected.revision, files, excludes: ['EVIDENCE_MANIFEST.json itself'], classification: 'Independent bounded review; first failure, accepted candidate and intentional negatives are separate cohorts' }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ verified: true, artifacts: files.length, checkedAbsentPids: processChecks.length, canonical: '10/10', mutant: '10/10 genuine rejection' }));
