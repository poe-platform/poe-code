import assert from 'node:assert/strict';
import { open, readFile, writeFile, unlink, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, jobs, hash, json, identity, verifyPrepared } from './binding.mjs';
import { supervise } from './supervise.mjs';

const [job] = process.argv.slice(2);
assert.ok(['controls', 'benign', ...jobs].includes(job));
const prepared = await verifyPrepared();
const evidence = resolve(owned, 'evidence');
const preparation = await identity(resolve(evidence, 'prepared.json'));
const isTarget = jobs.includes(job);
const absent = async path => { try { await access(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; } throw new Error(`must not exist: ${path}`); };
const lockPath = resolve(evidence, 'active.lock');
const lock = await open(lockPath, 'wx');
let reserved = false;
try {
  let approval;
  if (job !== 'controls') assert.equal((await json(resolve(evidence, 'controls.json'))).pass, true, 'benign supervisor controls must pass first');
  if (isTarget) {
    await absent(resolve(evidence, 'STOP.json'));
    const benign = await json(resolve(evidence, 'benign.json'));
    assert.equal(benign.pass, true);
    assert.equal(benign.preparedSha256, preparation.sha256);
    const approvalBytes = await readFile('/tmp/regex-containment-six-authorized.txt');
    approval = JSON.parse(approvalBytes);
    assert.equal(approval.authority, 'ROOT_EXPLICIT_EXECUTION_AFTER_REVIEWED_BENIGN_GREEN');
    assert.equal(approval.preparedSha256, preparation.sha256);
    assert.equal(approval.benignSha256, (await identity(resolve(evidence, 'benign.json'))).sha256);
    assert.equal(approval.controlsSha256, (await identity(resolve(evidence, 'controls.json'))).sha256);
    assert.equal(approval.sourceCommit, prepared.package.sourceCommit);
    assert.equal(approval.archiveSha256, prepared.package.archive.sha256);
    assert.equal(approval.fixtureCommit, prepared.fixture.commit);
    assert.equal(approval.reviewedIndependentBenignGreen, true);
    assert.equal(approval.noConcurrentLifecycleProbesOrPerformance, true);
    assert.equal(approval.totalTargetBudget, 6);
    assert.equal(approval.totalPathologicalRequestBudget, 4);
    assert.deepEqual(approval.jobs, jobs);
    assert.ok(Date.now() < Date.parse(approval.expiresAt), 'authorization expired');
    approval = { ...approval, sha256: hash(approvalBytes) };
    const index = jobs.indexOf(job);
    for (const previous of jobs.slice(0, index)) {
      const resultPath = resolve(evidence, `${previous}.json`);
      const previousResult = await json(resultPath);
      assert.equal(previousResult.pass, true, 'stop whole matrix on any failure');
      assert.equal(previousResult.preparedSha256, preparation.sha256);
      const review = await json(resolve(evidence, `${previous}-inspection.json`));
      assert.equal(review.resultSha256, (await identity(resultPath)).sha256);
      assert.equal(review.decision, 'PASS_REVIEWED_CONTINUE');
    }
    for (const later of jobs.slice(index)) await absent(resolve(evidence, `${later}-claim.json`));
  }
  const claim = { job, time: new Date().toISOString(), preparedSha256: preparation.sha256, approval, targetSlotsReserved: isTarget ? 1 : 0, pathologicalRequestsReserved: isTarget && !job.includes('queued') ? 1 : 0, noRetry: true };
  const claimHandle = await open(resolve(evidence, `${job}-claim.json`), 'wx');
  try { await claimHandle.writeFile(JSON.stringify(claim, null, 2) + '\n'); await claimHandle.sync(); }
  finally { await claimHandle.close(); }
  reserved = true;
  const journal = await open(resolve(evidence, 'journal.jsonl'), 'a');
  try { await journal.writeFile(JSON.stringify(claim) + '\n'); await journal.sync(); }
  finally { await journal.close(); }
  const runs = [];
  const childJobs = job === 'controls' ? ['success', 'already-aborted', 'owned-timeout', 'late-rejection'] : [job];
  for (const childJob of childJobs) {
    const entry = resolve(owned, '.temporary/compiled', childJob === 'benign' ? 'benign-entry.mjs' : 'child.mjs');
    runs.push(await supervise(childJob, entry, prepared.package.packageRoot, childJob.includes('queued') ? 8000 : 6000));
    if (!runs.at(-1).pass) break;
  }
  const pass = runs.length === childJobs.length && runs.every(run => run.pass);
  const result = { job, time: new Date().toISOString(), pass, preparedSha256: preparation.sha256, claim, runs, targetSlotsConsumed: isTarget ? 1 : 0, activeChildren: 0 };
  await writeFile(resolve(evidence, `${job}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (isTarget && !pass) await writeFile(resolve(evidence, 'STOP.json'), JSON.stringify({ job, reason: 'failed target; no rerun or remaining launches', time: new Date().toISOString() }) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ job, pass, children: runs.length, targetSlotsConsumed: result.targetSlotsConsumed, activeChildren: 0 }));
  if (!pass) process.exitCode = 1;
} catch (error) {
  if (reserved && isTarget) await writeFile(resolve(evidence, 'STOP.json'), JSON.stringify({ job, error: String(error), reason: 'reserved target could not be certified', time: new Date().toISOString() }) + '\n', { flag: 'wx' }).catch(() => {});
  throw error;
} finally {
  await lock.close();
  await unlink(lockPath);
}
