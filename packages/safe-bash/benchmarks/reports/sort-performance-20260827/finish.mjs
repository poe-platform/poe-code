import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..'), evidence = process.env.SORT_REPORT ?? join(own, 'evidence');
const state = process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), root = (await readFile(state, 'utf8')).trim();
assert.match(root, /^\/tmp\/safe-bash-sort-performance-[A-Za-z0-9]+$/);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : 1)) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path));
    else { assert.ok(entry.isFile(), path); result[path] = sha(await readFile(join(directory, path))); }
  }
  return result;
}
const before = JSON.parse(await readFile(join(root, 'manifest-before.json'), 'utf8'));
const report = { checkedAt: new Date().toISOString(), root, base: await hashes(join(root, 'base/src')), candidate: await hashes(join(root, 'candidate/src')),
  baseBuild: await hashes(join(root, 'base/dist')), candidateBuild: await hashes(join(root, 'candidate/dist')),
  baseTests: await hashes(join(root, 'base/tests')), candidateTests: await hashes(join(root, 'candidate/tests')),
  developmentDependencies: await hashes(join(root, 'node_modules')), baselineDependencies: await hashes(join(root, 'baseline/node_modules')),
  native: await hashes(join(root, 'native')), harnessUsed: await hashes(join(root, 'harness')) };
assert.deepEqual(report.base, before.source);
assert.deepEqual(report.baseTests, report.candidateTests);
assert.deepEqual(report.developmentDependencies, before.developmentDependencies);
assert.deepEqual(report.baselineDependencies, before.baselineDependencies); assert.deepEqual(report.native, before.native);
report.changedSourcePaths = Object.keys(report.base).filter(path => report.base[path] !== report.candidate[path]);
assert.deepEqual(report.changedSourcePaths, ['commands/text.ts']);
const proposal = JSON.parse(await readFile(join(own, 'prototypes/proposal.json'), 'utf8'));
assert.equal(report.candidate['commands/text.ts'], proposal.candidateSha256);
report.liveProductScope = {};
for (const path of ['src/commands/text.ts', 'src/commands/execution.ts', 'src/commands/internal.ts']) {
  const current = sha(await readFile(join(repo, path))), frozen = sha(execFileSync('git', ['show', `${before.revision}:${path}`], { cwd: repo }));
  report.liveProductScope[path] = { current, frozen, equal: current === frozen };
}
const replay = await mkdtemp('/tmp/safe-bash-sort-performance-');
const replayState = join(replay, 'state');
try {
  await mkdir(join(replay, 'candidate/src/commands'), { recursive: true });
  await cp(join(root, 'base/src/commands/text.ts'), join(replay, 'candidate/src/commands/text.ts'));
  await writeFile(replayState, replay + '\n');
  const run = () => spawnSync(process.execPath, [join(own, 'apply-prototype.mjs')], { env: { ...process.env, SORT_STATE: replayState }, encoding: 'utf8', timeout: 10000 });
  const positive = run(); assert.equal(positive.status, 0, positive.stderr);
  const negative = run(); assert.notEqual(negative.status, 0);
  report.patchReconstruction = { positiveStatus: positive.status, alreadyPatchedRefused: negative.status,
    sha256: sha(await readFile(join(replay, 'candidate/src/commands/text.ts'))) };
  assert.equal(report.patchReconstruction.sha256, proposal.candidateSha256);
} finally { await rm(replay, { recursive: true }); }
report.nativeVersions = Object.fromEntries(['sort', 'uniq'].map(name => [name, execFileSync(join(root, 'native', name), ['--version'], { env: { LC_ALL: 'C' } }).toString()]));
const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='], { encoding: 'utf8' }).split('\n');
report.remainingOwnedProcesses = processes.filter(line => line.includes(root) || line.includes(root.replace('/tmp/', '/private/tmp/')));
assert.deepEqual(report.remainingOwnedProcesses, []);
await rm(root, { recursive: true }); await rm(state);
report.ownedScratchRemoved = true; report.foreignAuthenticationArtifactsUntouched = true;
await writeFile(join(evidence, 'manifest-after.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(report.changedSourcePaths, report.patchReconstruction, 'owned scratch removed');
