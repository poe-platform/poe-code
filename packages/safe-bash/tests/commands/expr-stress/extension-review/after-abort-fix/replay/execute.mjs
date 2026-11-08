import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { command, stage as stageArchive } from './stage.mjs';
import { addEvidence, owned, root, git, json, sha256, verifyFrozen } from './review.mjs';

export function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `unexpected link ${path}`);
    return stat.isDirectory() ? inventory(path, relative) : [{ path: relative, sha256: sha256(readFileSync(path)) }];
  });
}
const mode = process.argv[2];
if (mode !== 'capture') {
  verifyFrozen();
  console.log('Read-only freeze verification; explicit capture required.');
} else {
  const candidate = JSON.parse(readFileSync(`${owned}/candidate-27a77935/stage.json`));
  assert.equal(candidate.commit, '27a7793526830768484885afba5832bf8bb248b5');
  const before = { source: inventory(join(candidate.source, 'src')), installed: inventory(candidate.installed), freezes: verifyFrozen() };
  assert.deepEqual(before.source, candidate.sourceFiles);
  assert.deepEqual(before.installed, candidate.installedFiles);
  addEvidence(`${owned}/integrity-before.json`, before);
  const oldSource = 'fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724';
  const delta = git('diff', '--name-status', oldSource, candidate.commit, '--', 'src').toString();
  addEvidence(`${owned}/source-provenance.json`, { oldSource, fixedSource: candidate.commit, delta, sourceDiff: git('diff', oldSource, candidate.commit, '--', 'src').toString(), duCommit: git('rev-parse', '877144ea^{commit}').toString().trim(), fixEvidenceCommit: git('rev-parse', '33b580db^{commit}').toString().trim(), wholeCommitDelta: git('diff', '--name-status', oldSource, candidate.commit).toString(), sourceInventorySha256: sha256(json(before.source)), installedInventorySha256: sha256(json(before.installed)) });
  const baseline = await stageArchive('8f19a9d5bb244ff6c095b7117e6d0738fdf40421', 'baseline-8f19a9d5', 'baseline');
  assert(!baseline.failure);
  const commands = [];
  async function run(id, args, cwd = root) {
    const result = await command(process.execPath, args, cwd);
    commands.push({ id, ...result });
    addEvidence(`${owned}/commands/${id}.json`, result);
    console.log(JSON.stringify({ id, status: result.status, failure: result.failure, output: result.stdout.slice(-2200), stderr: result.stderr.slice(-1000) }));
    return result;
  }
  await run('native-prerequisites', [`${owned}/review.mjs`, 'capture-native', 'native-27a77935']);
  await run('watchdog-selfcheck', [`${owned}/watchdog.mjs`]);
  await run('distribution', [`${owned}/distribution.mjs`, 'capture']);
  await run('native-acceptance', [`${owned}/accept-native.mjs`, 'acceptance-27a77935']);
  await run('frozen-controls', [`${owned}/accept-controls.mjs`, 'controls-27a77935']);
  await run('supplement', [`${owned}/supplement.mjs`, 'capture']);
  const historical = JSON.parse(git('show', 'f6e0533920d9583af80f044a327bfcaa381d7cac:tests/commands/expr-stress/extension-review/execution/candidate-fe7083d9-20260827/legacy-regressions.json'));
  const paths = historical.identities.map(item => item.path);
  const identities = paths.map(path => {
    const actual = sha256(readFileSync(join(candidate.source, path)));
    assert.equal(actual, sha256(git('show', `${candidate.commit}:${path}`)));
    assert.equal(actual, historical.identities.find(item => item.path === path).candidate);
    return { path, sha256: actual };
  });
  await run('legacy-276', historical.args, candidate.source);
  const cleanupPaths = ['tests/contracts/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-lifecycle.test.ts'];
  await run('invocation-cleanup', ['--import', 'tsx', '--test', '--test-concurrency=1', ...cleanupPaths], candidate.source);
  await run('author-abort-111', ['--import', 'tsx', '--test', 'tests/commands/expr/abort-reason-regression.test.ts'], candidate.source);
  addEvidence(`${owned}/archived-regression-inputs.json`, { identities, additional: [...cleanupPaths, 'tests/commands/expr/abort-reason-regression.test.ts'].map(path => ({ path, sha256: sha256(readFileSync(join(candidate.source, path))) })), authorClassification: '111 author regression cases replayed on archive, not independent holdouts; semantic cancellation coverage overlaps independent old probes and new typed consumer.' });
  assert.deepEqual(inventory(join(candidate.source, 'src')), before.source);
  assert.deepEqual(inventory(candidate.installed), before.installed);
  assert.deepEqual(verifyFrozen(), before.freezes);
  addEvidence(`${owned}/core-execution.json`, { candidate: candidate.commit, commands: commands.map(({ id, status, signal, failure }) => ({ id, status, signal, failure })), completedAt: new Date().toISOString(), beforeAfterSourceInstalledFrozenIncludingAdditions: true });
}
