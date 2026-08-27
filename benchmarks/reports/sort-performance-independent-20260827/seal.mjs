import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..'), target = join(own, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const artifacts = [];
async function add(path, bytes) {
  const text = bytes.toString().replace(/\n?$/, '\n'), scratch = await mkdtemp('/tmp/sort-review-seal-');
  try {
    const patch = join(scratch, 'artifact.patch'); await writeFile(patch, `*** Begin Patch\n*** Add File: ${join(target, path)}\n${text.split('\n').slice(0, -1).map(line => '+' + line).join('\n')}\n*** End Patch\n`);
    const handle = await open(patch, 'r');
    try { const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [handle.fd, 'pipe', 'pipe'] }); assert.equal(result.status, 0, result.stderr?.toString()); }
    finally { await handle.close(); }
  } finally { await rm(scratch, { recursive: true, force: true }); }
  artifacts.push({ path, sha256: hash(await readFile(join(target, path))) });
}
async function archive(directory, prefix = '') {
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) await archive(directory, path);
    else {
      assert.ok(entry.isFile(), path); const bytes = await readFile(join(directory, path));
      await add(path, entry.name.endsWith('.json') ? Buffer.from(JSON.stringify(JSON.parse(bytes)) + '\n') : bytes);
      Object.assign(artifacts.at(-1), { capturedSha256: hash(bytes), capturedBytes: bytes.length, transform: entry.name.endsWith('.json') ? 'lossless JSON compaction' : 'terminal newline normalization' });
    }
  }
}
if (process.argv.includes('--check')) {
  for (const entry of await json(join(target, 'ARTIFACTS.json'))) assert.equal(hash(await readFile(join(target, entry.path))), entry.sha256, entry.path);
  const checkpoint = await json(join(target, 'CHECKPOINT.json'));
  for (const [path, expected] of Object.entries(checkpoint.reviewerInputs)) assert.equal(hash(await readFile(join(own, path))), expected, path);
  for (const [path, expected] of Object.entries(checkpoint.committedFiles)) assert.equal(hash(execFileSync('git', ['show', `${checkpoint.integrationCommit}:${path}`], { cwd: repo })), expected, path);
  console.log('independent sort evidence, harness and committed integration verified');
} else {
  const directory = process.env.SORT_REPORT; assert.ok(directory?.startsWith('/tmp/'));
  const before = await json(join(directory, 'preparation.json')), after = await json(join(directory, 'manifest-after.json'));
  assert.equal(before.all955PublishedFilesMatch, true); assert.equal(before.publishedFileCount, 955);
  assert.deepEqual(after.changedSourcePaths, ['commands/text.ts']); assert.equal(after.ownedScratchRemoved, true); assert.deepEqual(after.remainingOwnedProcesses, []);
  await assert.rejects(access(after.root), error => error.code === 'ENOENT');
  const assessment = await json(join(directory, 'INDEPENDENT_ASSESSMENT.json')); assert.equal(assessment.measuredRows, 720);
  assert.deepEqual(assessment.matchedCounts, { base: { total: 240, matched: 240 }, candidate: { total: 240, matched: 240 }, baseline: { total: 240, matched: 192 } });
  const validation = await json(join(directory, 'validation-final/validation.json'));
  for (const variant of ['base', 'candidate']) {
    assert.equal(validation.find(row => row.variant === variant && row.label === 'unchanged-core100').counts.pass, 100);
    assert.equal(validation.find(row => row.variant === variant && row.label === 'adjacent-sort-expanded').counts.pass, 65);
    assert.equal(validation.find(row => row.variant === variant && row.label === 'fresh-heldouts').counts.pass, variant === 'base' ? 25 : 26);
  }
  const hiddenInitial = await json(join(directory, 'independent-hidden/REPORT.json')), hidden = await json(join(directory, 'independent-hidden-corrected/REPORT.json'));
  assert.deepEqual(hiddenInitial.commands.map(command => command.counts.pass), [20, 29]); assert.deepEqual(hidden.commands.map(command => command.counts.pass), [21, 30]);
  for (const command of [...hiddenInitial.commands, ...hidden.commands]) { assert.deepEqual(command.survivors, []); assert.equal(command.timedOut, false); }
  const liveInitial = await json(join(directory, 'live-integration/manifest.json')), live = await json(join(directory, 'live-integration-node-profile/manifest.json'));
  assert.equal(liveInitial.source, live.source); assert.equal(liveInitial.commands['scoped-types'].status, 2);
  assert.equal(live.commands.targeted.counts.pass, 167); assert.equal(live.commands.build.status, 0); assert.equal(live.commands['scoped-types'].status, 0); assert.equal(live.inputsUnchanged, true);
  for (const manifest of [liveInitial, live]) { assert.equal(manifest.cleaned, true); await assert.rejects(access(manifest.scratch), error => error.code === 'ENOENT'); for (const command of Object.values(manifest.commands)) assert.deepEqual(command.survivors, []); }
  const proposal = await json(join(repo, 'benchmarks/reports/sort-performance-20260827/prototypes/proposal.json'));
  const integrationCommit = execFileSync('git', ['rev-parse', '7ba5301^{commit}'], { cwd: repo }).toString().trim();
  const paths = execFileSync('git', ['show', '--format=', '--name-only', integrationCommit], { cwd: repo }).toString().trim().split('\n');
  assert.deepEqual(paths, ['src/commands/text.ts', 'tests/commands/core-sort/borrowed-buffer.test.ts']);
  const checkpoint = { capturedAt: new Date().toISOString(), sourceDeltaAccepted: true, integrated: true, overallSuperiority: false, integrationCommit,
    prototypeSource: before.revision, currentIntegrationSource: live.source, proposal, assessment, committedFiles: live.overlay, reviewerInputs: {}, authorHarnessInputs: {},
    originalCohorts: validation, independentHiddenInitial: hiddenInitial.commands.map(({ counts, failures }) => ({ counts, failures })), independentHiddenCorrected: hidden.commands.map(({ counts, failures }) => ({ counts, failures })),
    cleanup: { timingWorkers: 183, allExited: true, forced: 0, ownedScratchRemoved: true }, scope: 'Exact32-line candidate plus2 public regressions; no root/config/shared helper/other author changes' };
  assert.equal(checkpoint.committedFiles['src/commands/text.ts'], proposal.candidateSha256);
  for (const [path, expected] of Object.entries(checkpoint.committedFiles)) assert.equal(hash(execFileSync('git', ['show', `${integrationCommit}:${path}`], { cwd: repo })), expected);
  for (const name of ['README.md', 'hidden.mjs', 'validate.mjs', 'fixtures.mjs', 'assess.mjs', 'apply-exact.mjs', 'validate-live.mjs', 'seal.mjs']) checkpoint.reviewerInputs[name] = hash(await readFile(join(own, name)));
  for (const name of ['prepare.mjs', 'apply-prototype.mjs', 'validate.mjs', 'holdouts.mjs', 'mutants.mjs', 'workloads.mjs', 'worker.mjs', 'session.mjs', 'measure.mjs', 'summarize.mjs', 'finish.mjs', 'prototypes/candidate.patch']) {
    const path = 'benchmarks/reports/sort-performance-20260827/' + name;
    const current = await readFile(join(repo, path)), pinned = execFileSync('git', ['show', `3d2e6ff:${path}`], { cwd: repo }); assert.equal(hash(current), hash(pinned), path);
    checkpoint.authorHarnessInputs[name] = hash(current);
  }
  await archive(directory);
  await add('CHECKPOINT.json', Buffer.from(JSON.stringify(checkpoint, null, 2) + '\n'));
  await add('ARTIFACTS.json', Buffer.from(JSON.stringify(artifacts, null, 2) + '\n'));
  console.log(JSON.stringify({ integrationCommit, candidateHash: proposal.candidateSha256, capturedArtifacts: artifacts.length }));
}
