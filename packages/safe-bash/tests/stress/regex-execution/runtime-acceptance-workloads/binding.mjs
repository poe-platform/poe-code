import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const owned = resolve('tests/stress/regex-execution/runtime-acceptance-workloads');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const workspace = '/Users/kjopek/Workspace/safe-bash';
export async function checkedPath(path) {
  const actual = await realpath(resolve(path));
  assert.ok(actual.startsWith(workspace + sep), 'only this workspace');
  return actual;
}
export async function checkedJSON(binding) {
  const path = await checkedPath(binding.path);
  const bytes = await readFile(path);
  assert.equal(hash(bytes), binding.sha256, path);
  return JSON.parse(bytes);
}
export async function prepared() {
  const record = JSON.parse(await readFile(resolve(owned, 'evidence/prepared.json')));
  for (const entry of [...record.source, ...record.emitted]) assert.equal(hash(await readFile(resolve(owned, entry.path))), entry.sha256, entry.path);
  return record;
}
export async function authorize(job, approvalPath, preparation) {
  assert.ok(approvalPath, 'explicit root approval file required; readiness markers never authorize runs');
  const approvalBytes = await readFile(await checkedPath(approvalPath));
  const approval = JSON.parse(approvalBytes);
  assert.equal(approval.authority, 'ROOT_EXPLICIT_EXECUTION_AFTER_REVIEWED_BENIGN_GREEN');
  assert.equal(approval.noConcurrentLifecycleProbesOrPerformance, true);
  assert.ok(approval.jobs.includes(job));
  assert.ok(Date.now() < Date.parse(approval.expiresAt), 'root authorization expired');
  assert.deepEqual(approval.commits, preparation.commits);
  assert.equal(approval.preparedSha256, hash(await readFile(resolve(owned, 'evidence/prepared.json'))));
  const controls = await checkedJSON(approval.controls);
  assert.equal(controls.pass, true);
  assert.equal(controls.riskConsumed, 0);
  assert.equal(controls.preparedSha256, approval.preparedSha256);
  assert.equal(approval.originalFiveCompiledAndPackedGreen, true);
  assert.equal(approval.actualPublicLifecycleGreen, true);
  assert.ok(approval.benignEvidence.length >= 3, 'compiled five, packed five, actual lifecycle evidence required');
  for (const entry of approval.benignEvidence) await checkedJSON(entry);
  const candidate = approval.candidate;
  const freeze = await checkedJSON(candidate.freeze);
  const build = await checkedJSON(candidate.build);
  assert.equal(freeze.commit, preparation.commits.runtime);
  assert.equal(build.status, 0);
  assert.ok(freeze.identities.length > 0 && build.emitted.length > 0);
  for (const entry of preparation.pinned.filter(entry => entry.role !== 'fixture')) assert.equal(freeze.identities.find(identity => identity.path === entry.path)?.sha256, entry.sha256, entry.path);
  const packageRoot = await checkedPath(candidate.packageRoot);
  assert.ok(packageRoot.endsWith('/node_modules/virtual-bash'), 'moved installed package only');
  assert.equal(hash(await readFile(await checkedPath(candidate.archivePath))), candidate.archiveSha256);
  const snapshotRoot = await checkedPath(candidate.snapshotRoot);
  for (const entry of freeze.identities) assert.equal(hash(await readFile(await checkedPath(resolve(snapshotRoot, entry.path)))), entry.sha256, entry.path);
  for (const entry of build.emitted) {
    assert.ok(entry.path.startsWith('dist/'));
    assert.equal(hash(await readFile(await checkedPath(resolve(snapshotRoot, entry.path)))), entry.sha256, entry.path);
    assert.equal(hash(await readFile(await checkedPath(resolve(packageRoot, entry.path)))), entry.sha256, entry.path);
  }
  assert.ok(build.emitted.some(entry => entry.path === 'dist/commands/regex-execution/worker.js'));
  assert.equal(hash(await readFile(resolve(packageRoot, 'package.json'))), freeze.identities.find(entry => entry.path === 'package.json')?.sha256);
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json')));
  assert.equal(manifest.name, 'virtual-bash');
  assert.deepEqual(manifest.dependencies ?? {}, {});
  let baselineRoot;
  if (job === 'benchmark') {
    const baseline = approval.baseline;
    const historical = path => execFileSync('git', ['show', `839f2d4:tests/stress/regex-execution/production-continuation-review/${path}`], { maxBuffer: 16 * 1024 * 1024 });
    assert.equal(baseline.freeze.sha256, hash(historical('evidence/baseline-freeze.json')));
    assert.equal(baseline.build.sha256, hash(historical('evidence/baseline/build.json')));
    const baselineFreeze = await checkedJSON(baseline.freeze);
    const baselineBuild = await checkedJSON(baseline.build);
    assert.equal(baselineFreeze.head, '329eb2722052e8ace0ec18a751f12c30ed87a25b');
    assert.equal(baselineBuild.status, 0);
    baselineRoot = await checkedPath(baseline.snapshotRoot);
    for (const entry of [...baselineFreeze.identities, ...baselineBuild.emitted]) assert.equal(hash(await readFile(await checkedPath(resolve(baselineRoot, entry.path)))), entry.sha256, entry.path);
  }
  return { packageRoot, baselineRoot, approval, approvalSha256: hash(approvalBytes) };
}
