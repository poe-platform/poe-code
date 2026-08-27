import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticateSourceTests, inventory } from './integrity.mjs';
import { addEvidence, git, json, owned, root, sha256, verifyFrozen } from './replay/review.mjs';
import { command, stage } from './replay/stage.mjs';

const candidate = '21220b465537bf45ffcfb36740956a69f43bf75e';
const preparation = '1231700a9f049262235759bbf07f58b939ae646b';
const original = 'tests/commands/expr-stress/diagnostics-review';
const mode = process.argv[2];
if (mode === 'stage') {
  const startedAt = new Date().toISOString();
  const preparationFiles = inventory(original);
  const names = git('ls-tree', '-r', '-z', '--name-only', preparation, '--', original).toString().split('\0').filter(Boolean);
  assert.deepEqual(preparationFiles.map(entry => `${original}/${entry.path}`).sort(), names.sort());
  for (const path of names) assert.deepEqual(readFileSync(path), git('show', `${preparation}:${path}`));
  const dependencies = JSON.parse(readFileSync(`${owned}/devdeps-authentication.json`));
  for (const pin of dependencies.historicalPins) assert.equal(sha256(readFileSync(join(root, 'node_modules', pin.path))), pin.sha256);
  for (const tree of dependencies.currentToolTrees) assert.deepEqual(inventory(join(root, 'node_modules', tree.path)).map(({ path, sha256 }) => ({ path, sha256 })), tree.files);
  addEvidence(`${owned}/before.json`, { startedAt, candidate, preparation, preparationFiles, frozen: verifyFrozen(), dependenciesAuthenticated: true, status: git('status', '--short').toString(), index: git('diff', '--cached', '--name-status').toString(), sourceDelta: git('diff', '--binary', '27a7793526830768484885afba5832bf8bb248b5', candidate, '--', 'src').toString(), candidateCommit: git('show', '--format=fuller', '--stat', candidate).toString(), authorSeal: JSON.parse(git('show', '7fc76f3917a38c0cc39d46c02383c947fa3ac110:tests/commands/expr-author/diagnostics-fix/SEAL.json')) });
  for (const [commit, label, kind] of [[candidate, 'candidate-diagnostics', 'candidate'], ['8f19a9d5bb244ff6c095b7117e6d0738fdf40421', 'baseline-8f19a9d5', 'baseline']]) {
    const result = await stage(commit, label, kind);
    assert(!result.failure, json(result.failure));
    const sourceTests = authenticateSourceTests(result);
    addEvidence(`${owned}/${label}/source-tests-before.json`, { commit, count: sourceTests.length, digest: sha256(json(sourceTests)), files: sourceTests });
  }
} else if (mode === 'run') {
  const candidateStage = JSON.parse(readFileSync(`${owned}/candidate-diagnostics/stage.json`));
  const runs = [
    ['watchdog-selfcheck', `${owned}/watchdog.mjs`, []],
    ['native-requalification', `${owned}/review.mjs`, ['capture-native', 'native-current']],
    ['distribution', `${owned}/distribution.mjs`, ['capture']],
    ['independent', `${owned}/../independent.mjs`, ['candidate-diagnostics', 'independent-first']],
    ['full-native-candidate', `${owned}/accept-native.mjs`, ['acceptance-diagnostics']],
    ['core-controls', `${owned}/accept-controls.mjs`, ['core-controls']],
    ['supplement', `${owned}/supplement.mjs`, ['capture']],
    ['frozen-comparators', `${owned}/comparators.mjs`, ['capture']],
  ];
  for (const [id, script, args] of runs) {
    const result = await command(process.execPath, [script, ...args], root, 240000);
    addEvidence(`${owned}/execution/${id}.json`, { id, scriptSha256: sha256(readFileSync(script)), ...result });
    console.log(JSON.stringify({ id, status: result.status, failure: result.failure, stdout: result.stdout, stderr: result.stderr.slice(-2000) }));
    if (id === 'native-requalification') assert.equal(result.status, 0, json(result));
  }
  const legacy = JSON.parse(readFileSync(`${owned}/legacy-plan.json`));
  const exprFiles = git('ls-tree', '-r', '-z', '--name-only', candidate, '--', 'tests/commands/expr').toString().split('\0').filter(path => path.endsWith('.test.ts') && !path.endsWith('/diagnostics-regression.test.ts'));
  for (const [id, args] of [
    ['shared-legacy276', legacy.args],
    ['author-diagnostics71', ['--import', 'tsx', '--test', '--test-reporter=spec', 'tests/commands/expr/diagnostics-regression.test.ts']],
    ['expr-legacy241', ['--import', 'tsx', '--test', '--test-reporter=spec', ...exprFiles]],
  ]) {
    const result = await command(process.execPath, args, candidateStage.source, 240000);
    addEvidence(`${owned}/regressions/${id}.json`, { candidate, exactArchivedTests: true, ...result, stdoutBase64: Buffer.from(result.stdout).toString('base64'), stderrBase64: Buffer.from(result.stderr).toString('base64') });
    console.log(JSON.stringify({ id, status: result.status, failure: result.failure, stdoutTail: result.stdout.slice(-4500), stderr: result.stderr }));
  }
} else throw new Error('Use stage or run');
