import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, checkGuards, json, owned, repository, save, sha256 } from './auth.mjs';

const root = json(join(owned, 'ROOT-EXECUTION.json'));
const guards = json(join(owned, 'preparation/INPUT-GUARDS.json'));
checkGuards(guards);
const { loadData, materializeJobs } = await import(pathToFileURL(join(root.runtimeRecipeRoot, 'fixtures.mjs')).href);
const recipe = json(join(repository, base, 'executor-preparation-v1/integration-v2/core/RECIPE.json'));
const jobs = materializeJobs(loadData(root.runtimeRecipeRoot, repository), recipe.preparedIds);
assert.equal(jobs.length, 149);
assert.equal(sha256(JSON.stringify(jobs)), recipe.jobsSha256);
const rows = json(join(owned, 'execution/OBSERVATIONS.json')).filter((row) => row.runtime);
const observations = [];
for (const row of rows) {
  const job = jobs.find((job) => job.id === row.jobId);
  assert(job);
  const receipt = json(join(owned, row.evidence, 'receipt.json'));
  const actual = receipt.capture;
  const facts = [];
  if (Number.isInteger(job.expected.status)) facts.push({ field: 'status', declared: job.expected.status, observed: actual.status, same: job.expected.status === actual.status });
  const expectedHex = job.expected.stdoutHex ?? (typeof job.expected.stdoutUtf8 === 'string' ? Buffer.from(job.expected.stdoutUtf8).toString('hex') : undefined);
  if (expectedHex !== undefined) facts.push({ field: 'stdoutHex', declared: expectedHex, observed: actual.stdoutHex, same: expectedHex === actual.stdoutHex });
  if (job.expected.diagnosticCode) {
    const text = Buffer.from(actual.stderrHex, 'hex').toString('utf8');
    facts.push({ field: 'diagnosticCodeTextPresenceOnly', declared: job.expected.diagnosticCode, observed: text, same: text.includes(job.expected.diagnosticCode) });
  }
  observations.push({ mode: row.mode, jobId: row.jobId, evidence: row.evidence, frozenAggregateUnchanged: row.aggregate,
    classificationUnchanged: row.classification, rawRejected: actual.rejected, rawCleanupErrors: actual.cleanupErrors,
    facts, contradictions: facts.filter((fact) => !fact.same), fullRecordPass: false });
}
checkGuards(guards);
save(join(owned, 'execution/DECLARED-JOBS-149.json'), { jobsSha256: recipe.jobsSha256, jobs, dataReconstructionOnly: true, productImports: 0 });
save(join(owned, 'execution/RAW-PRIMITIVE-AUDIT.json'), {
  method: 'Read-only comparison of already-captured status/explicit stdout bytes/diagnostic text against exact hash-bound prepared jobs, including captures whose assertions stop at unknown obligations. No case rerun or assertion change.',
  jobsSha256: recipe.jobsSha256, observations, contradictions: observations.filter((row) => row.contradictions.length),
  noFrozenFailureRescored: true, noMissingObligationWaived: true, semanticPassesAdded: 0, productRuns: 0,
});
console.log(JSON.stringify({ capturedRuntimeJobs: rows.length, primitiveContradictions: observations.filter((row) => row.contradictions.length).length, noRescoring: true }));
