import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, sha, json, absent } from './common.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)); const root = path.join(own, 'attempt-01');
const expectedOutcomeSha256 = process.argv[2]; assert.match(expectedOutcomeSha256, /^[0-9a-f]{64}$/); assert.equal(process.argv.length, 3);
const seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
for (const [name, expected] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), expected, name);
const membership = JSON.parse(fs.readFileSync(path.join(root, 'CAPTURE-MEMBERSHIP.json')));
assert.deepEqual(Object.keys(membership), ['schema', 'members', 'retainedScratch', 'externalRecords', 'totalBytes', 'combinedAccountedBeforeIndex']);
assert.equal(membership.schema, 'exact-regular-capture-membership-v1');
assert.deepEqual(fs.readdirSync(root).sort(), [...Object.keys(membership.members), 'CAPTURE-MEMBERSHIP.json', ...(membership.retainedScratch ? ['work'] : [])].sort());
for (const [name, expected] of Object.entries(membership.members)) {
  assert.ok(name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'));
  assert.deepEqual(describe(path.join(root, name)), expected, name);
}
for (const [name, expected] of Object.entries(membership.externalRecords)) {
  assert.ok(['BUILD-RECEIPT.json', 'RUNTIME-SEAL.json'].includes(name)); assert.deepEqual(describe(path.join(own, name)), expected, name);
}
assert.equal(describe(path.join(root, 'OUTCOME.json')).sha256, expectedOutcomeSha256, 'outer terminal outcome binding');
const outcome = JSON.parse(fs.readFileSync(path.join(root, 'OUTCOME.json'))); assert.equal(outcome.candidate, seal.candidate);
assert.equal(outcome.sealHash, sha(fs.readFileSync(path.join(own, 'PRESEAL.json'))));
const events = fs.readFileSync(path.join(root, 'OWNER-EVENTS.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
const ownerPid = events.find(row => row.kind === 'outer-startup-capture').ownerPid;
assert.ok(absent(ownerPid), 'owner must be retired before postflight');
const cohorts = []; const failures = [];
function counts(rows) { return Object.fromEntries([...new Set(rows.map(row => row.status))].map(status => [status, rows.filter(row => row.status === status).length])); }
for (const receipt of outcome.receipts) {
  assert.ok(receipt.closeObserved && receipt.absent && absent(receipt.pid), `exact child retirement ${receipt.id}`);
  for (const channel of ['stdout', 'stderr']) {
    const record = receipt[channel]; assert.ok(Object.hasOwn(membership.members, record.path));
    const actual = describe(path.join(root, record.path)); assert.equal(actual.sha256, record.sha256); assert.equal(actual.bytes, record.bytes);
    assert.equal(record.observedBytes - record.bytes, record.lostBytes);
  }
}
for (const observation of outcome.observations) {
  if (observation.role === 'type') { cohorts.push({ id: observation.id, count: 1, counts: { [observation.pass ? 'PASS' : 'FAIL']: 1 } }); if (!observation.pass) failures.push(observation); continue; }
  if (!observation.final) continue;
  const final = observation.final; assert.equal(final.complete, true); assert.equal(final.unhandled, 0);
  for (const [index, result] of final.outcomes.entries()) {
    if (result.kind === 'legacy') {
      for (const prefix of ['P', 'S', 'V6-', 'L']) {
        const rows = result.cases.filter(row => row.id.startsWith(prefix)); if (!rows.length) continue;
        cohorts.push({ id: `${observation.id}/${result.graph ?? index}/${prefix}`, count: rows.length, counts: counts(rows), mutationPhase: result.phase ?? null, mutationAccepted: result.accepted ?? null });
        for (const row of rows.filter(row => row.status === 'FAIL')) failures.push({ job: observation.id, phase: result.phase ?? null, ...row });
      }
    } else if (result.kind === 'unchanged-author') {
      const rows = result.cases.map(row => ({ ...row, status: row.pass ? 'PASS' : 'FAIL' }));
      cohorts.push({ id: `${observation.id}/unchanged-author63`, count: rows.length, counts: counts(rows) });
      for (const row of rows.filter(row => !row.pass)) failures.push({ job: observation.id, cohort: 'author63', ...row });
    } else if (result.results) {
      cohorts.push({ id: `${observation.id}/${result.graph ?? 'unmodified'}`, count: result.results.length, counts: counts(result.results), expectedMutant: result.expectedMutant ?? null, mutationAccepted: result.accepted ?? null });
      for (const row of result.results.filter(row => row.status === 'FAIL')) failures.push({ job: observation.id, expectedMutant: result.expectedMutant ?? null, ...row });
    }
  }
}
const evidence = path.join(path.dirname(own), 'candidate-753-review-evidence-v1'); assert.equal(fs.existsSync(evidence), false); fs.mkdirSync(evidence);
const report = { classification: 'independent actual one-attempt review; no automatic product/default acceptance', candidate: seal.candidate, preseal: outcome.sealHash, sourceCommit: outcome.sourceCommit, runtimeCommit: outcome.runtimeCommit, status: outcome.status, completedJobs: outcome.completedJobs.length, plannedJobs: 54, cohorts, failures, primary: outcome.primary, parentReaped: true, allChildrenReaped: true, allOwnedActualSubject: outcome.allOwnedAdmitted, postflightProcesses: 1, archivalGitPlanned: 2, subjectPeakTotal: outcome.totalPeak, targetPeak: outcome.targetFlatPeak, rawBytes: outcome.rawBytes, combinedFilesBytes: membership.combinedAccountedBeforeIndex + describe(path.join(root, 'CAPTURE-MEMBERSHIP.json')).bytes, elapsedMs: outcome.clockMs, cleanup: outcome.cleanup, captureMembership: describe(path.join(root, 'CAPTURE-MEMBERSHIP.json')), historical: 'all58be and harness HOLDs unchanged; original STATIC/NOT_RUN not transformed into passes; expected mutant failures and original obsolete expectations are separate from genuine product failures' };
fs.writeFileSync(path.join(evidence, 'REPORT.json'), json(report), { flag: 'wx', mode: 0o644 });
const lines = ['# Candidate753 one-attempt evidence', '', `Status: ${report.status}. Completed ${report.completedJobs}/54 planned jobs.`, `Candidate: ${report.candidate}.`, `Preseal commit: ${report.sourceCommit}. Runtime seal commit: ${report.runtimeCommit ?? 'none'}.`, '', 'No automatic acceptance: raw failures, historical expectations, mutants and unmeasured rows remain separate.', '', '| Cohort | Rows | Counts |', '| --- | ---: | --- |', ...cohorts.map(row => `| ${row.id} | ${row.count} | ${JSON.stringify(row.counts)} |`), '', `Subject process admissions ${report.allOwnedActualSubject}; total peak ${report.subjectPeakTotal}; target peak ${report.targetPeak}.`, `One separate postflight Node, two planned direct archival Git processes. Owner/children all absent.`, `Combined capture files ${report.combinedFilesBytes} bytes; raw child streams ${report.rawBytes} bytes.`, `Cleanup: ${JSON.stringify(report.cleanup)}.`, '', `Primary STOP: ${JSON.stringify(report.primary)}.`, '', 'REPORT.json retains each failure and exact category. No candidate production or root exports changed. All prior immutable evidence remains unchanged.', ''];
fs.writeFileSync(path.join(evidence, 'README.md'), lines.join('\n'), { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ status: report.status, completed: report.completedJobs, cohortCounts: cohorts, failures: failures.map(row => ({ job: row.job, id: row.id, phase: row.phase, expectedMutant: row.expectedMutant, failures: row.failures, error: row.error })), primary: report.primary, reaped: true, combinedCaptureBytes: report.combinedFilesBytes, subjectAdmissions: report.allOwnedActualSubject }, null, 2));
