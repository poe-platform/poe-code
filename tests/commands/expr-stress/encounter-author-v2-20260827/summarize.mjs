import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const load = path => JSON.parse(readFileSync(join(owned, path)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const baseline = load('quota-baseline-01/original-results.json');
const candidate = load('candidate-01/original-results.json');
const frozen = JSON.parse(readFileSync(join(root, 'tests/commands/expr-stress/encounter-independent-v2-20260827/freeze/original-cases.json')));
const baselineSummary = load('quota-baseline-01/summary.json');
const candidateSummary = load('candidate-01/summary.json');
const sourceCommit = candidateSummary.sourceCommit;
const quotaCommit = candidateSummary.quotaCommit;
const sourcePaths = ['src/commands/expr/syntax.ts', 'src/commands/expr/evaluate.ts', 'src/commands/expr/index.ts', 'tests/commands/expr/encounter-order.test.ts'];
const readonlyPaths = ['src/commands/expr/internal.ts', 'src/commands/expr/bre-worker.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/protocol.ts'];
const hashes = Object.fromEntries([...sourcePaths, ...readonlyPaths].map(path => [path, sha256(git('show', `${sourceCommit}:${path}`))]));
for (const path of readonlyPaths) assert.equal(hashes[path], sha256(git('show', `${quotaCommit}:${path}`)));
const quotaIndex = git('show', `${quotaCommit}:src/commands/expr/index.ts`);
const candidateIndex = git('show', `${sourceCommit}:src/commands/expr/index.ts`);
const expectedIndex = quotaIndex.replace('bytes, characterCount, evaluate, smallInteger', 'bytes, characterCount, smallInteger')
  .replace('import { parse }', 'import { evaluateExpression }')
  .replace('          const tree = parse(context.args, budget, context.args[0] === "--" ? 1 : 0);\n          const value = await evaluate(tree, budget,', '          const value = await evaluateExpression(context.args, budget,')
  .replace('          });\n          exitCode = truth(value, budget)', '          }, context.args[0] === "--" ? 1 : 0);\n          exitCode = truth(value, budget)');
assert.equal(candidateIndex, expectedIndex, 'quota fix preserved byte-for-byte outside exact call/import integration');
assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', sourceCommit).trim().split('\n').sort(), sourcePaths.sort());
const failures = baseline.cases.flatMap((entry, index) => entry.passed ? [] : [{
  id: entry.id, category: entry.jobs.length !== frozen.cases[index].jobs ? 'regex-order/submission' : 'arithmetic/noninteger-order',
  args: frozen.cases[index].args, env: frozen.cases[index].env ?? { LC_ALL: 'C' }, expected: frozen.cases[index].expected,
  baseline: { observed: entry.observed, jobs: entry.jobs, events: entry.events, failures: entry.failures },
  candidate: { observed: candidate.cases[index].observed, jobs: candidate.cases[index].jobs, events: candidate.cases[index].events, failures: candidate.cases[index].failures },
}]);
assert.equal(failures.length, 19);
assert.equal(failures.filter(entry => entry.category === 'regex-order/submission').length, 8);
assert(failures.every(entry => entry.candidate.failures.length === 0));
const historical = [
  ['e9ff18dc', 'tests/commands/expr-stress/sequencing-design-20260827/freeze/cases.json'],
  ['e9ff18dc', 'tests/commands/expr-stress/sequencing-design-20260827/driver.mjs'],
  ['514f8407', 'tests/commands/expr-stress/sequencing-design-20260827/baseline-01/product.json'],
  ['514f8407', 'tests/commands/expr-stress/sequencing-design-20260827/baseline-01/native-semantics.json'],
  ['cf5caabe', 'tests/commands/expr-stress/qualified-final-review-20260827/sequencing-unchanged.json'],
].map(([commit, path]) => {
  const hash = sha256(git('show', `${commit}:${path}`));
  assert.equal(sha256(readFileSync(join(root, path))), hash, path);
  return { commit, path, sha256: hash };
});
const nearby = load('candidate-01/nearby-results.json');
const result = {
  sourceCommit, quotaCommit, sourceHashes: hashes, atomicSourcePaths: sourcePaths,
  quotaFixPreservedOutsideExactIntegration: true, readonlyProductionPathsUnchanged: readonlyPaths,
  historicalSelectedPathsUnchanged: historical,
  original: { old: baselineSummary.original, new: candidateSummary.original },
  nearby: { old: baselineSummary.nearby, new: candidateSummary.nearby },
  focused: { old: { passed: 9, total: 28 }, new: { passed: 28, total: 28 }, provenance: 'Frozen new author regression file; baseline uses quota source with this candidate-bound test file, never relabelled as historical old tests.' },
  unchangedSelectedCanonical: { old: { passed: 558, total: 559 }, new: { passed: 558, total: 559 }, exclusions: 'Two native-oracle test files not executed; 28 new tests excluded from this old-test denominator.' },
  exprAggregate: { old: baselineSummary.expr, new: candidateSummary.expr },
  shared: { old: baselineSummary.shared, new: candidateSummary.shared, overlap: 'Five expr regex-protocol tests overlap expr aggregate; do not sum into unique coverage.' },
  categories: { arithmeticNoninteger: 11, regexOrderingSubmissions: 8, unchangedFinalDiagnosticButNowRequiredJob: ['regex-success-before-trailing', 'regex-success-before-missing-close', 'first-regex-before-second-syntax'] },
  failures,
  remaining: { original61: [], nearby: nearby.cases.filter(entry => !entry.passed), oldCapSeparate: candidate.oldCap, canonical: { path: 'tests/commands/expr/contracts.test.ts:138', args: ['1'], env: { LC_ALL: 'C' }, expectedStatus: 3, expectedDiagnosticPattern: 'execution or output failure', observed: 'rejects original Error("sink failure"); no status returned; zero matcher jobs; no stderr write. First await fails, so the diagnostic-sink assertions later in this same test are not reached.', cause: 'Already present on released quota-only baseline; not introduced by encounter traversal.' } },
  canonicalParseAllConflict: 'No new parse-all-before-jobs expectation failure in the 559 unchanged selected non-native canonical tests. Do not invent one. Frozen old driver traces exhibit the 19 production-ordering defects above; they are historical observations, not current passing assertions.',
};
writeFileSync(join(owned, 'ORDERING-DELTA.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ sourceCommit, original: result.original, categories: result.categories }, null, 2));
