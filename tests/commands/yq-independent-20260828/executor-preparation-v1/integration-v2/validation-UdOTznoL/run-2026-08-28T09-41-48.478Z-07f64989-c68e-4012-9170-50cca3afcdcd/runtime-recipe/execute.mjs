import assert from 'node:assert/strict';
import { join } from 'node:path';
import { authorize } from './authorization.mjs';
import { assertCapture } from './assert-capture.mjs';
import { runJobs } from './host.mjs';

const [authorizationPath, authorizationSha256, sealPath, sealSha256] = process.argv.slice(2);
const bound = authorize({ authorizationPath, authorizationSha256, sealPath, sealSha256 });
const jobs = bound.jobs.map((job) => ({ ...job, cwd: bound.authorization.compiled.root, args: [join(bound.recipeRoot, 'child.mjs'), authorizationPath, authorizationSha256, sealPath, sealSha256, job.id] }));
const result = await runJobs({
  executable: bound.authorization.node.path, jobs, guards: bound.guards,
  evidenceParent: bound.authorization.evidenceParent, bounds: bound.authorization.bounds,
  assertReceipt(receipt, job, evidence) {
    assert.deepEqual(receipt.binding, {
      authorizationSha256, sealSha256, candidateCommit: bound.authorization.candidateCommit,
      sourceTreeSha256: bound.authorization.source.treeSha256, compiledEntrySha256: bound.authorization.compiled.entry.sha256,
      jobsSha256: bound.authorization.selection.jobsSha256,
    });
    assert.equal(receipt.proofRole, 'direct-compiled-factory-handler-not-public-package');
    assertCapture(receipt, job, evidence, bound.data.sources.get('final').diagnostics.catalogue);
  },
});
process.stdout.write(`${JSON.stringify({ aggregate: result.aggregate, evidence: result.evidence, admittedProjections: result.admitted, semanticFullRecordPasses: 'Not computed by projection runner; inventory missing bindings and all variants govern eligibility.' })}\n`);
process.exitCode = result.aggregate === 'PASS' ? 0 : 1;
