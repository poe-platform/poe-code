import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { own, repository, prefix, oldLayer, candidate, authorFreeze, independentFreeze, helperPath, expectedSource,
  sha256, git, text, sourceAt, json, write, writeJson, inventory, objectCollector, liveState, launch } from './support-v1.mjs';

const phase = process.argv[2];
const output = process.argv[3] ?? 'evidence-v1';
assert.match(output, /^[a-zA-Z0-9_-]+$/);
const evidence = join(own, output);
const scratch = join(own, `.scratch-${output}`);
const source = join(scratch, 'source');
const build = join(scratch, 'build');
const moved = join(scratch, 'moved-internal');
const fixtures = join(scratch, 'fixtures');
const tools = join(scratch, 'tools');
const node = join(tools, 'node');
const compiler = join(tools, 'typescript/lib/tsc.js');
const frozen = JSON.parse(sourceAt(independentFreeze, `${prefix}/FREEZE-v1.json`));
const oldPrefix = relative(repository, oldLayer);
const oldOriginal = 'tests/shell/cancellation-stage1-independent-20260827';
const authorPrefix = 'tests/shell/cancellation-stage1-20260827';
const runtimeFixtures = [
  ['extension12', 'extension-v1.mjs', 'cbed682564e1e3b1c2ac8062157ece7b8b997f30', `${oldPrefix}/extension-v1.mjs`, 12],
  ['original12', 'original12.mjs', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldOriginal}/cohort-v1.mjs`, 12],
  ['nearby4', 'nearby4.mjs', '61092847acc8d2c54af109a5bbeefe22146488d3', `${oldOriginal}/repair-fbbe1ef7/nearby-v1.mjs`, 4],
  ['new2', 'new2.mjs', independentFreeze, `${prefix}/nearby-v1.mjs`, 2],
];
const typeFixtures = [
  ['old-positive', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldOriginal}/positive-v1.ts.data`, []],
  ['old-six-negative', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldOriginal}/negative-v1.ts.data`, [2, 3, 4, 5, 6, 7]],
  ['extension-positive', 'cbed682564e1e3b1c2ac8062157ece7b8b997f30', `${oldPrefix}/positive-v1.ts.data`, []],
  ['extension-eight-negative', 'cbed682564e1e3b1c2ac8062157ece7b8b997f30', `${oldPrefix}/negative-v1.ts.data`, [5, 6, 7, 8, 9, 10, 11, 12]],
];
const record = (name, value) => writeJson(join(evidence, `${name}.json`), value);
const execute = (name, args, environment) => launch(evidence, scratch, name, node, args, environment);

function config(files, emitDirectory) {
  return { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], types: [], strict: true,
    exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: !emitDirectory, declaration: Boolean(emitDirectory), ...(emitDirectory ? { outDir: emitDirectory } : {}) }, files };
}
function compile(name, directory, destination) {
  writeJson(join(directory, 'tsconfig.json'), config(['cancellation.ts'], relative(directory, destination)));
  const result = execute(name, [compiler, '--project', join(directory, 'tsconfig.json'), '--pretty', 'false']);
  assert.equal(result.status, 0, `${name}: compile succeeds`);
  writeJson(join(destination, 'package.json'), { type: 'module' });
}
function runtime(name, module, filename, pattern) {
  const loadLog = join(evidence, `${name}-loads.jsonl`);
  const exitLog = join(evidence, `${name}-children.jsonl`);
  const fixture = join(fixtures, filename);
  const args = ['--import', join(fixtures, 'register-guard-v1.mjs'), '--test', '--test-reporter=tap'];
  if (pattern) args.push('--test-name-pattern', pattern);
  args.push(fixture);
  const result = execute(name, args, { CANCELLATION_MODULE: module, CANCELLATION_MODULE_SHA256: sha256(readFileSync(module)),
    REVIEW_ALLOWED_FILES: JSON.stringify([realpathSync(module), realpathSync(fixture)]), REVIEW_LOAD_LOG: loadLog, REVIEW_EXIT_LOG: exitLog });
  const loads = readFileSync(loadLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(loads.filter(entry => entry.filename === realpathSync(module)).length, 1);
  const children = readFileSync(exitLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const started of children.filter(entry => entry.kind === 'start')) assert.equal(children.filter(entry => entry.kind === 'exit' && entry.pid === started.pid).length, 1, 'each runner/test child exits normally');
  const count = key => Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
  const summary = { exit: result.status, tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'), skipped: count('skipped'), todo: count('todo'),
    records: [...result.stdout.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(match => ({ pass: match[1] === 'ok', name: match[2] })), naturalProcesses: children.filter(entry => entry.kind === 'start').length };
  assert.ok(Number.isFinite(summary.tests));
  assert.equal(summary.cancelled, 0);
  record(name + '-summary', summary);
  console.log(JSON.stringify({ name, ...summary }));
  return summary;
}
function typecheck(name, directory, fixture, expectedRows, declaration) {
  const filename = `${name}.ts`;
  write(join(directory, filename), readFileSync(join(fixtures, fixture)));
  writeJson(join(directory, `tsconfig-${name}.json`), config([filename]));
  const result = execute(name, [compiler, '--project', join(directory, `tsconfig-${name}.json`), '--pretty', 'false', '--listFiles']);
  const diagnostics = [...result.stdout.matchAll(/([^\n]+)\((\d+),(\d+)\): error TS(\d+): ([^\n]+)/g)]
    .map(match => ({ file: match[1], line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] }));
  assert.equal(result.status, expectedRows.length ? 2 : 0);
  assert.deepEqual(diagnostics.map(entry => entry.line), expectedRows);
  assert.ok(diagnostics.every(entry => entry.file.endsWith(filename) && [2322, 2345, 2540, 2739, 2740, 2741].includes(entry.code)));
  assert.equal(result.stderr, '');
  const listed = result.stdout.split('\n').filter(line => line.startsWith(scratch + '/'));
  const helper = join(directory, declaration ? 'cancellation.d.ts' : 'cancellation.ts');
  assert.ok(listed.includes(helper), 'compiler actually consumes expected source/declaration');
  assert.ok(listed.every(path => path === helper || path === join(directory, filename) || path.startsWith(join(tools, 'typescript/lib') + '/')), 'no live/source fallback');
  record(name + '-diagnostics', { expectedRows, diagnostics, exit: result.status, helper, loadedFiles: listed.map(path => ({ path: relative(scratch, path), sha256: sha256(readFileSync(path)) })) });
}

function authenticate() {
  const collector = objectCollector();
  const candidateRaw = collector.keep('commit', candidate).toString();
  assert.equal(candidateRaw.match(/^parent (.+)$/m)[1], authorFreeze);
  const repairSource = sourceAt(candidate, helperPath);
  const previousSource = sourceAt(authorFreeze, helperPath);
  assert.equal(sha256(repairSource), expectedSource);
  assert.equal(sha256(previousSource), 'f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5');
  const repaired = '  if (captured.kind === "throw" && classified?.role !== "invoke-option") {\n    return throwingSelection(state, captured.reason, classified);';
  const original = '  if (captured.kind === "throw" && !classified) {\n    return throwingSelection(state, captured.reason);';
  assert.equal(repairSource.toString().split(repaired).length, 2);
  assert.equal(repairSource.toString().replace(repaired, original), previousSource.toString(), 'exact two-line-only repair');
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).toString().trim(), helperPath);
  for (const commit of [candidate, authorFreeze, independentFreeze]) collector.bind(commit, helperPath, true);
  const ownParent = collector.keep('commit', independentFreeze).toString().match(/^parent (.+)$/m)[1];
  collector.bind(ownParent, relative(repository, oldLayer));
  collector.bind(independentFreeze, `${prefix}/FREEZE-v1.json`, true);
  for (const [filename, digest] of Object.entries(frozen.files)) {
    assert.equal(collector.bind(independentFreeze, `${prefix}/${filename}`, true).sha256, digest);
  }
  for (const input of frozen.inputs) {
    const actual = collector.bind(input.commit, input.path, true);
    assert.equal(actual.oid, input.blob);
    assert.equal(actual.sha256, input.sha256);
  }
  const preserved = [];
  for (const path of ['src/contracts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'src/shell/cleanup.ts', 'src/index.ts', 'src/plugins/index.ts', 'package.json', 'package-lock.json', oldOriginal, oldPrefix, authorPrefix]) {
    const before = collector.bind(authorFreeze, path, false, [oldOriginal, oldPrefix, authorPrefix].includes(path));
    const after = collector.bind(candidate, path);
    assert.equal(before.oid, after.oid);
    preserved.push({ path, oid: after.oid, type: after.type });
  }
  const previousDeclarations = collector.bind('8e62751d4b3b05cb493bed79aa1fd535df251da8', `${oldPrefix}/evidence-v2/artifacts/cancellation.d.ts.data`, true);
  write(join(evidence, 'raw-object-proof.json.gz'), gzipSync(JSON.stringify(collector.snapshot())));
  write(join(evidence, 'candidate.patch'), git('diff', authorFreeze, candidate, '--', helperPath));
  record('authentication', { candidate, authorFreeze, independentFreeze, ownParent, helperBlob: text('rev-parse', `${candidate}:${helperPath}`), helperSha256: expectedSource,
    changedPaths: [helperPath], exactTwoLineRepair: true, priorBodyBeforeRuntimeSelectorUnchanged: repairSource.toString().split('export function selectRuntimeCancellationOutcome')[0] === previousSource.toString().split('export function selectRuntimeCancellationOutcome')[0],
    preserved, previousDeclarations });
}

async function prepare() {
  assert.equal(existsSync(evidence), false);
  assert.equal(existsSync(scratch), false);
  mkdirSync(evidence);
  const before = liveState();
  assert.deepEqual(before.oldLayer, frozen.protectedOldLayer.members, 'complete old layer unchanged; only exact new subtree excluded');
  record('live-before', before);
  authenticate();
  for (const directory of [source, fixtures, tools, join(scratch, 'tmp')]) mkdirSync(directory, { recursive: true });
  const originalNode = realpathSync(process.execPath);
  copyFileSync(originalNode, node);
  chmodSync(node, 0o755);
  const originalTypescript = join(repository, 'node_modules/typescript');
  const toolOrigin = { node: { path: originalNode, sha256: sha256(readFileSync(originalNode)) }, typescript: inventory(originalTypescript) };
  cpSync(originalTypescript, join(tools, 'typescript'), { recursive: true, dereference: true, errorOnExist: true, force: false });
  record('tool-origin', toolOrigin);
  record('tools-before', inventory(tools));
  assert.deepEqual(inventory(join(tools, 'typescript')), toolOrigin.typescript);
  write(join(source, 'cancellation.ts'), sourceAt(candidate, helperPath));
  writeJson(join(source, 'package.json'), { type: 'module' });
  const typescript = (await import(pathToFileURL(join(tools, 'typescript/lib/typescript.js')).href)).default;
  const parsed = typescript.createSourceFile('cancellation.ts', readFileSync(join(source, 'cancellation.ts'), 'utf8'), typescript.ScriptTarget.Latest, true);
  const references = [];
  function walk(entry) {
    if (typescript.isImportDeclaration(entry) || typescript.isExportDeclaration(entry) && entry.moduleSpecifier || typescript.isCallExpression(entry) && (entry.expression.kind === typescript.SyntaxKind.ImportKeyword || entry.expression.getText(parsed) === 'require')) references.push(entry.getText(parsed));
    typescript.forEachChild(entry, walk);
  }
  walk(parsed);
  assert.deepEqual(references, []);
  record('import-closure', { files: [helperPath], references, sourceSha256: expectedSource });
  const bindings = [];
  for (const [, filename, commit, path] of runtimeFixtures) { const bytes = sourceAt(commit, path); write(join(fixtures, filename), bytes); bindings.push({ filename, commit, path, sha256: sha256(bytes) }); }
  for (const [name, commit, path] of typeFixtures) { const bytes = sourceAt(commit, path); write(join(fixtures, `${name}.ts.data`), bytes); bindings.push({ filename: `${name}.ts.data`, commit, path, sha256: sha256(bytes) }); }
  const guard = sourceAt('8e62751d4b3b05cb493bed79aa1fd535df251da8', `${oldPrefix}/load-guard-v1.mjs`);
  write(join(fixtures, 'load-guard-v1.mjs'), guard);
  write(join(fixtures, 'register-guard-v1.mjs'), readFileSync(join(own, 'register-guard-v1.mjs')));
  record('fixture-bindings', { bindings, guards: { loaderCommit: '8e62751d4b3b05cb493bed79aa1fd535df251da8', loaderSha256: sha256(guard), registrarIsHarnessOnly: true }, members: inventory(fixtures) });
  record('source-before', inventory(source));
  execute('node-version', ['--version']);
  execute('typescript-version', [compiler, '--version']);
  compile('candidate-build', source, build);
  const declarations = readFileSync(join(build, 'cancellation.d.ts'));
  assert.equal(sha256(declarations), json(join(evidence, 'authentication.json')).previousDeclarations.sha256, 'actual declarations unchanged byte-for-byte');
  record('source-after-build', inventory(source));
  record('build-before', inventory(build));
  record('prepare-complete', { complete: true });
}

function baseline() {
  for (const [cohort, filename] of runtimeFixtures) runtime(`${cohort}-isolated`, join(build, 'cancellation.js'), filename);
  record('baseline-complete', { complete: true });
}

function finish() {
  for (const [name, , , rows] of typeFixtures) typecheck(`${name}-source`, source, `${name}.ts.data`, rows, false);
  mkdirSync(moved);
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) copyFileSync(join(build, filename), join(moved, filename));
  record('moved-before', inventory(moved));
  record('source-build-before-removal', { source: inventory(source), build: inventory(build) });
  rmSync(source, { recursive: true });
  rmSync(build, { recursive: true });
  record('source-build-removal', { sourceAbsent: !existsSync(source), buildAbsent: !existsSync(build), enumeratedBeforeRemoval: true });
  for (const [cohort, filename] of runtimeFixtures) runtime(`${cohort}-moved`, join(moved, 'cancellation.js'), filename);
  for (const [name, , , rows] of typeFixtures) typecheck(`${name}-moved`, moved, `${name}.ts.data`, rows, true);
  const first = json(join(evidence, 'extension12-isolated-summary.json'));
  assert.equal(first.records.find(entry => entry.name.startsWith('E07 '))?.pass, true, 'candidate E07 must pass before revert counterfactual');
  const counterfactual = join(scratch, 'revert-repair');
  mkdirSync(counterfactual);
  const beforeRepair = sourceAt(authorFreeze, helperPath);
  write(join(counterfactual, 'cancellation.ts'), beforeRepair);
  writeJson(join(counterfactual, 'package.json'), { type: 'module' });
  record('revert-before', inventory(counterfactual));
  compile('revert-build', counterfactual, join(counterfactual, 'emitted'));
  const mutant = runtime('revert-E07', join(counterfactual, 'emitted/cancellation.js'), 'extension-v1.mjs', '^E07 ');
  assert.equal(mutant.exit, 1);
  assert.equal(mutant.tests, 1);
  assert.equal(mutant.fail, 1);
  assert.match(readFileSync(join(evidence, 'revert-E07.stdout'), 'utf8'), /ERR_ASSERTION/);
  record('counterfactual', { candidateWitness: 'E07', candidateWitnessPassed: true, revertedSourceCommit: authorFreeze, revertedSourceSha256: sha256(beforeRepair), exactRevert: true, compiled: true, authenticatedLoad: true, behavioralKill: true });
  record('revert-after', inventory(counterfactual));
  for (const [name, file] of [['historical-extension-audit', 'audit-v1.mjs'], ['historical-commit-audit', 'commit-audit-v1.mjs']]) {
    const result = execute(name, [join(oldLayer, file), 'verify']);
    assert.equal(result.status, 0, 'unchanged historical verifier remains valid, not a repair result');
  }
  record('fixtures-after', inventory(fixtures));
  record('tools-after', inventory(tools));
  record('moved-after', inventory(moved));
  assert.deepEqual(inventory(fixtures), json(join(evidence, 'fixture-bindings.json')).members);
  assert.deepEqual(inventory(tools), json(join(evidence, 'tools-before.json')));
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) write(join(evidence, 'artifacts', `${filename}.data`), readFileSync(join(moved, filename)));
  const after = liveState();
  const before = json(join(evidence, 'live-before.json'));
  record('live-after', after);
  assert.deepEqual(after.oldLayer, before.oldLayer);
  assert.deepEqual(after.oldLayer, frozen.protectedOldLayer.members);
  assert.deepEqual(after.originalStage1, before.originalStage1);
  assert.deepEqual(after.authorHistory, before.authorHistory);
  assert.equal(after.index.stagedBase64, before.index.stagedBase64, 'foreign staged entries unchanged; HEAD movements allowed');
  record('live-comparison', { oldLayerEqualExceptSoleAuthorizedAppend: true, originalStage1Equal: true, authorHistoryEqual: true, foreignStagingEqual: true,
    fullIndexIdentical: before.index.sha256 === after.index.sha256, beforeHead: before.index.head, afterHead: after.index.head,
    reservedLiveEqual: JSON.stringify([before.files, before.shell, before.contracts]) === JSON.stringify([after.files, after.shell, after.contracts]), liveInputsNeverOverlaid: true });
  record('scratch-before-removal', inventory(scratch));
  record('durable-before-cleanup', { captured: true, enumerated: true });
  rmSync(scratch, { recursive: true });
  record('scratch-cleanup', { path: scratch, absent: !existsSync(scratch), enumerated: true });
  record('finish-complete', { complete: true, stage2Authorized: false });
}

try {
  if (phase === 'prepare') await prepare();
  else if (phase === 'baseline') baseline();
  else if (phase === 'finish') finish();
  else throw new Error('usage: run-v1.mjs prepare|baseline|finish [new-owned-output-name]');
} catch (error) {
  if (existsSync(evidence)) record(`${phase}-error-${Date.now()}`, { message: error.message, stack: error.stack });
  throw error;
} finally {
  if (existsSync(evidence)) {
    const stamp = `${phase}-driver-${Date.now()}`;
    for (const filename of ['run-v1.mjs', 'support-v1.mjs', 'register-guard-v1.mjs']) write(join(evidence, `${stamp}-${filename}.data`), readFileSync(join(own, filename)));
  }
}
