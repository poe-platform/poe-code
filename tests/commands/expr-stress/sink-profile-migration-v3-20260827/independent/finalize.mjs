import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, root, product, base, hash, git, frozen, save, put, inventory } from './lib.mjs';

const state = JSON.parse(readFileSync(join(owned, 'run-02/state.json')));
const originalState = JSON.parse(readFileSync(join(owned, 'run-01/state.json')));
const output = state.output;
const summary = JSON.parse(readFileSync(join(output, 'replay-summary.json')));
const negatives = JSON.parse(readFileSync(join(output, 'negative/summary.json')));
assert.deepEqual(summary.original.canonical, { status: 1, tests: 237, pass: 236, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(summary.revised.canonical, { status: 0, tests: 237, pass: 237, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
for (const [cohort, count, failure] of [['core', 146, 'sink-rejection'], ['quota', 47, 'stdout-rejection-normal-quota'], ['nearby', 16, 'stdout-failure-no-regex-replay']]) {
  assert.equal(summary.original[cohort].passed, count - 1); assert.equal(summary.original[cohort].total, count); assert.deepEqual(summary.original[cohort].failed, [failure]);
  assert.equal(summary.revised[cohort].passed, count); assert.equal(summary.revised[cohort].total, count); assert.deepEqual(summary.revised[cohort].failed, []);
}
assert.equal(negatives.positives, 4); assert.equal(negatives.rejectedMutants, 20);
const specificity = [];
for (const result of negatives.results.filter(result => !result.expectedPositive)) {
  let expected;
  if (result.target === 'canonical') {
    expected = ['swallow', 'recast'].includes(result.mutation) ? 'Missing expected rejection' : result.mutation === 'duplicate-diagnostic' ? '2 !== 0' : 'validation function is expected to return "true"';
    assert(result.failure.includes(expected), `${result.target}/${result.mutation}: named assertion`);
  } else if (result.target === 'core') {
    expected = ['swallow', 'recast'].includes(result.mutation) ? "'fulfilled'" : result.mutation === 'duplicate-diagnostic' ? "'stderr'" : 'reference-equal';
    assert(result.failure.includes(expected));
  } else {
    expected = result.target === 'quota' ? 'exact result and rejection identity' : 'rejection identity/output';
    assert(result.failure.includes(expected));
  }
  specificity.push({ target: result.target, mutation: result.mutation, actualAssertion: expected, detected: true });
}
const sourceBefore = JSON.parse(readFileSync(join(owned, 'run-01/source-before.json')));
const compiledBefore = JSON.parse(readFileSync(join(owned, 'run-01/compiled-before.json')));
const installedBefore = JSON.parse(readFileSync(join(owned, 'run-01/installed-before.json')));
const sourceAfter = Object.fromEntries(Object.entries(inventory(state.source)).filter(([path]) => path !== 'dist' && !path.startsWith('dist/')));
assert.deepEqual(sourceAfter, sourceBefore);
assert.deepEqual(inventory(join(state.source, 'dist')), compiledBefore);
assert.deepEqual(inventory(state.installed), installedBefore);
assert.equal(hash(git('archive', '--format=tar', product, ...state.selected)), state.archiveSha256);
for (const [path, record] of Object.entries(sourceBefore)) if (record.sha256) assert.equal(hash(frozen(path, product)), record.sha256);
save(join(output, 'source-after.json'), sourceAfter);
save(join(output, 'compiled-after.json'), inventory(join(state.source, 'dist')));
save(join(output, 'installed-after.json'), inventory(state.installed));
const authorManifest = JSON.parse(readFileSync(join(owned, 'audit-03/author/MANIFEST.json.data')));
const authorRows = authorManifest.records.map(record => {
  assert.equal(hash(readFileSync(join(owned, '../author', record.path))), record.sha256, record.path);
  return { path: record.path, sha256: record.sha256, unchanged: true };
});
const ts = await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')).href);
const dist = join(state.installed, 'dist');
const modules = new Map(), builtins = new Set();
function walk(path) {
  const key = relative(dist, path); assert(!key.startsWith('..'));
  if (modules.has(key)) return;
  const bytes = readFileSync(path), text = bytes.toString();
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  const imports = [];
  function inspect(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert(ts.isStringLiteral(node.moduleSpecifier)); imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      assert(ts.isStringLiteral(node.arguments[0]), 'computed import requires separate audit'); imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(parsed);
  assert.equal(hash(bytes), compiledBefore[key].sha256);
  modules.set(key, { sha256: hash(bytes), imports });
  for (const specifier of imports) {
    if (specifier.startsWith('node:')) builtins.add(specifier);
    else { assert(specifier.startsWith('.'), 'no package runtime dependency'); walk(resolve(dirname(path), specifier)); }
  }
}
walk(join(dist, 'commands/regex-execution/worker.js'));
const closures = Object.fromEntries(modules);
assert(Object.keys(closures).includes('commands/expr/bre-worker.js'));
const canonicalImports = {};
for (const profile of ['original', 'revised']) {
  const records = readFileSync(join(output, profile + '-canonical-imports.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const starts = records.filter(record => record.kind === 'worker-start'), exits = records.filter(record => record.kind === 'worker-exit');
  assert.equal(starts.length, exits.length); assert(starts.length > 0);
  for (const record of starts) assert.equal(record.url, pathToFileURL(join(dist, 'commands/regex-execution/worker.js')).href);
  canonicalImports[profile] = { records: records.length, workerStarts: starts.length, workerExits: exits.length, workersSettled: true };
  const core = JSON.parse(readFileSync(join(output, profile, 'core-controls.json')));
  for (const row of core.rows) {
    assert.notEqual(row.state, 'outer-timeout', row.id);
    if (row.value?.activeBeforeSafetyCleanup !== undefined) assert.equal(row.value.activeBeforeSafetyCleanup, 0, row.id);
    if (row.value?.liveWorkers !== undefined) assert.equal(row.value.liveWorkers, 0, row.id);
  }
}
const sources = ['src/commands/expr/index.ts','src/commands/expr/internal.ts','src/commands/expr/syntax.ts','src/commands/expr/evaluate.ts','src/commands/expr/bre-worker.ts','src/commands/regex-execution/client.ts','src/commands/regex-execution/worker.ts','src/commands/regex-execution/protocol.ts','src/index.ts','package.json','package-lock.json'].map(path => ({ path, sha256: hash(frozen(path, product)), blob: git('rev-parse', `${product}:${path}`).toString().trim() }));
save(join(output, 'final-integrity.json'), { checkedAt: new Date().toISOString(), product, sourceTree: git('rev-parse', `${product}:src`).toString().trim(), sources, sourceArchiveSha256: state.archiveSha256, sourceArchiveMatchesBebaCore: true, allCompiledFilesMatchBebaCore: true, packageSha256: state.packageSha256, originalConsumerPathAbsent: !existsSync(join(state.scratch, 'consumer')), installedPhysicalPath: realpathSync(state.installed), packageContainsNoSource: !existsSync(join(state.installed, 'src')), runtimeDependencies: JSON.parse(readFileSync(join(state.installed, 'package.json'))).dependencies ?? {}, workerClosure: closures, workerClosureBuiltins: [...builtins].sort(), workerClosureQualifiedByExactCompiledBeforeHashes: true, canonicalImports, specificity, authorRows, appendAwareSourceDistInstalledChecks: true, sourceIgnoredAfterBuild: ['dist (separately checked exhaustively)'], liveHEADInputsUsed: false, externalOracleRecapture: false, globalRepositoryCleanlinessClaim: false });
save(join(output, 'temporary-before-cleanup.json'), inventory(state.temporary));
save(join(output, 'task-before-cleanup.json'), inventory(state.scratch));
const taskRoot = realpathSync(state.scratch);
assert(taskRoot.includes('/expr-sink-independent-v3-'));
rmSync(taskRoot, { recursive: true, force: false });
assert(!existsSync(taskRoot)); assert(!existsSync(originalState.scratch));
save(join(output, 'cleanup.json'), { finishedAt: new Date().toISOString(), taskRoot, absent: true, originalAliasAbsent: true, removalsRestrictedToTaskRoot: true, noSIGSTOP: true, coreRealVfsScratchRemoved: summary.original.core.realVfsScratchRemoved && summary.revised.core.realVfsScratchRemoved, canonicalImports, quotaSafetyTerminations: [summary.original.quota.safetyTerminations, summary.revised.quota.safetyTerminations], nearbyActiveWorkers: [summary.original.nearby.activeWorkers, summary.revised.nearby.activeWorkers], historicalAttempt: '../replay-attempt-01.json' });
console.log('Exact deltas, named negative sensitivity, c3 closure, append-aware integrity and cleanup verified.');
