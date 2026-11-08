import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { prepare, load, sha256, json, patchNew, snapshot } from './prepare.mjs';
import { bind } from './adapter.mjs';
import { controls } from './controls.mjs';

const argumentsList = process.argv.slice(2);
const retainCapture = argumentsList.includes('--capture');
const root = resolve(argumentsList.find(argument => !argument.startsWith('--')) ?? '.');
const state = prepare(root);
console.log(`TEMPORARY=${state.temporary}`);
try {
patchNew('preparation.json', state.provenance, state.temporary);
const harnessFiles = ['prepare.mjs', 'adapter.mjs', 'controls.mjs', 'regex-probe.mjs', 'run.mjs', 'consumer.mts.data'];
const harnessManifest = harnessFiles.map(path => ({ path, sha256: sha256(readFileSync(join(root, 'tests/commands/expr-stress/nonregex-review', path))) }));
const bound = await bind(state.installed);
const inputs = load(join(state.frozen, 'inputs.json'));
const oracle = load(join(state.frozen, 'evidence/original-20260827/oracle.json'));
const inputCases = inputs.cases;
assert.equal(inputCases.length, 95);
const byId = new Map(inputCases.map(entry => [entry.id, entry]));
const explicitRegexIds = new Set(['or-skip-invalid-regex', 'and-skip-invalid-match', 'evaluated-regex-error', 'workflow-basename-fallback', 'workflow-version-major', 'unicode-regex-dot', 'unicode-capture', ...inputCases.filter(entry => entry.group === 'regex').map(entry => entry.id)]);
const profiles = [];
const comparison = [];
for (const profile of oracle.profiles.filter(entry => entry.oracle === 'gnu')) {
  const results = [];
  for (const expected of profile.results) {
    const input = byId.get(expected.id);
    assert(input);
    const actual = await bound.direct(input.argv, {}, { env: profile.environment });
    const row = { id: input.id, caseSha256: expected.caseSha256, status: actual.status, stdoutBase64: actual.stdoutBase64, stderrBase64: actual.stderrBase64, signal: actual.signal, failure: actual.failure };
    results.push(row);
    const semantic = row.status === expected.status && row.stdoutBase64 === expected.stdoutBase64 && Boolean(row.stderrBase64) === Boolean(expected.stderrBase64) && row.failure === null;
    const diagnostic = row.stderrBase64 === expected.stderrBase64;
    const error = Buffer.from(row.stderrBase64, 'base64').toString();
    comparison.push({ profile: profile.id, id: input.id, argv: input.argv, independentSubset: explicitRegexIds.has(input.id) ? 'regex-containing' : 'nonregex', semantic, diagnostic, strict: semantic && diagnostic, classification: semantic && diagnostic ? 'exact' : error.includes('BRE protocol is pending') ? 'known-pending-regex-status3' : error.includes('require C/POSIX') || error.includes('requires C/POSIX') ? 'unsupported-locale-profile' : semantic ? 'diagnostic-only-mismatch' : 'baseline-semantic-defect', expected, observed: row });
  }
  profiles.push({ id: profile.id, results });
}
const adapterSha256 = sha256(readFileSync(join(root, 'tests/commands/expr-stress/nonregex-review/adapter.mjs')));
const report = { schema: 1, freezeManifestSha256: sha256(readFileSync(join(state.frozen, 'evidence/original-20260827/manifest.json'))), candidate: { commit: state.provenance.candidateCommit, sourceTreeSha256: state.provenance.sourceTreeSha256, adapterSha256, dirty: false }, profiles };
const summarize = rows => ({ denominator: rows.length, semantic: rows.filter(row => row.semantic).length, diagnostic: rows.filter(row => row.diagnostic).length, strict: rows.filter(row => row.strict).length, classifications: rows.reduce((counts, row) => ({ ...counts, [row.classification]: (counts[row.classification] ?? 0) + 1 }), {}) });
const summary = { allGNU: summarize(comparison), nonregex: summarize(comparison.filter(row => row.independentSubset === 'nonregex')), regexContaining: summarize(comparison.filter(row => row.independentSubset === 'regex-containing')), profiles: profiles.map(profile => ({ id: profile.id, ...summarize(comparison.filter(row => row.profile === profile.id)), nonregex: summarize(comparison.filter(row => row.profile === profile.id && row.independentSubset === 'nonregex')) })), subsetRule: 'Explicit independently reviewed input IDs containing expr regex syntax; skipped regex still excluded from nonregex subset.', uniqueInputs: { original: inputCases.length, nonregex: inputCases.filter(input => !explicitRegexIds.has(input.id)).length, regexContaining: explicitRegexIds.size }, regexIds: [...explicitRegexIds].sort(), regexSafety: 'NOT READY — no product regex executor in this baseline; not passes', productAcceptance: false };
patchNew('candidate-report.json', report, state.temporary);
patchNew('comparison.json', comparison, state.temporary);
const comparator = state.run(process.execPath, ['--input-type=module', '-', 'compare', join(state.temporary, 'candidate-report.json')], { input: readFileSync(join(state.frozen, 'runner.mjs.data')) });
patchNew('frozen-comparator.json', { status: comparator.status, stdout: comparator.stdout.toString(), stderr: comparator.stderr.toString() }, state.temporary);
assert.equal(comparator.status, 1, 'frozen comparator must retain the nonzero mismatch result');
const consumerSource = readFileSync(join(root, 'tests/commands/expr-stress/nonregex-review/consumer.mts.data'), 'utf8');
patchNew('consumer.mts', consumerSource, state.moved);
assert(!existsSync(join(state.installed, 'src')), 'installed package must have no source fallback');
state.required(process.execPath, [state.compiler, 'consumer.mts', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), '--outDir', state.moved], { cwd: state.moved });
state.required(process.execPath, ['consumer.mjs'], { cwd: state.moved });
const measuredControls = await controls(bound, state);
patchNew('controls.json', measuredControls, state.temporary);
summary.controls = measuredControls.measurements;
summary.standaloneConsumer = { strict: 'PASS', runtime: 'PASS', moved: true, offlineInstall: true, publicExprSubpath: false, authenticatedInternalDistModule: true, consumerSourceSha256: sha256(consumerSource) };
summary.canonicalComparatorExitCode = comparator.status;
summary.replayExitCode = comparison.some(row => !row.strict) || measuredControls.cases.some(row => row.status !== 'PASS') || measuredControls.workflows.some(row => row.status !== 'PASS') ? 1 : 0;
const require = createRequire(import.meta.url);
const typescript = require(join(root, 'node_modules/typescript/lib/typescript.js'));
const reachable = [];
const visited = new Set();
function audit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = readFileSync(path, 'utf8');
  const tree = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
  const imports = [];
  const dynamicImports = [];
  function visit(node) {
    if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier && typescript.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (typescript.isCallExpression(node) && node.expression.kind === typescript.SyntaxKind.ImportKeyword) dynamicImports.push(node.getText(tree));
    typescript.forEachChild(node, visit);
  }
  visit(tree);
  reachable.push({ path: path.slice(state.installed.length + 1), sha256: sha256(source), imports, dynamicImports });
  for (const specifier of imports) if (specifier.startsWith('.')) audit(resolve(path, '..', specifier));
}
audit(bound.identity.modulePath);
assert(reachable.every(entry => entry.dynamicImports.length === 0));
assert(!reachable.some(entry => entry.imports.some(specifier => ['node:fs', 'node:child_process', 'node:net', 'node:http', 'node:https', 'node:worker_threads'].includes(specifier))));
const nativeReceipt = load(join(state.frozen, 'evidence/original-20260827/oracle.json'));
const executedNative = {};
const fixture = join(state.temporary, 'native-version-empty');
state.required('/bin/mkdir', [fixture]);
for (const name of ['gnu', 'apple']) {
  const identity = nativeReceipt.identities[name];
  const executable = identity.actualPath;
  assert.equal(sha256(readFileSync(executable)), identity.sha256);
  const version = state.required(executable, ['--version'], { cwd: fixture, argv0: 'expr', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' }, timeout: 2000, maxBuffer: 65536 });
  executedNative[name] = { executable, sha256: identity.sha256, version: version.toString(), versionSupported: name === 'gnu', linkedLibraries: state.required('/usr/bin/otool', ['-L', executable], { cwd: fixture, timeout: 2000, maxBuffer: 65536 }).toString() };
}
assert.deepEqual(snapshot(fixture), []);
assert.deepEqual(snapshot(state.retiredSource, ['node_modules', 'dist']), state.sourceBefore);
assert.deepEqual(snapshot(join(state.installed, 'dist')), state.built);
assert.deepEqual(snapshot(join(state.retiredSource, 'dist')), state.built);
assert.deepEqual(snapshot(state.frozen), state.frozenBefore);
assert.deepEqual(snapshot(join(root, 'tests/commands/expr-stress/frozen')), state.frozenBefore);
for (const entry of harnessManifest) assert.equal(sha256(readFileSync(join(root, 'tests/commands/expr-stress/nonregex-review', entry.path))), entry.sha256);
summary.integrity = { sourceBeforeAfter: true, buildBeforeAfter: true, installedDistMatchesBuild: true, frozenBeforeAfter: true, liveFrozenMatchesArchive: true, enumeratesNewEntries: true, directoryEntriesIncluded: true, excludesOnlyCandidateNodeModulesSymlinkAndGeneratedDistFromSourceComparison: true };
patchNew('provenance.json', { ...state.provenance, finishedAt: new Date().toISOString(), adapter: bound.identity, adapterSha256, harnessManifest, executedNative, reachableExprRuntimeModules: reachable, compilerImplementationSha256: sha256(readFileSync(join(root, 'node_modules/typescript/lib/_tsc.js'))), consumerEmittedSha256: sha256(readFileSync(join(state.moved, 'consumer.mjs'))), integrity: summary.integrity }, state.temporary);
patchNew('summary.json', summary, state.temporary);
console.log(json(summary));
console.log(json(comparison.filter(row => row.classification === 'baseline-semantic-defect')));
process.exitCode = summary.replayExitCode;
} catch (error) {
  patchNew('execution-failure.json', { error: String(error), stack: error?.stack ?? null, commands: state.provenance.commands }, state.temporary);
  throw error;
} finally {
  if (!retainCapture) { rmSync(state.temporary, { recursive: true, force: true }); console.log(`CLEANED=${state.temporary}`); }
  else console.log(`CAPTURE_REQUIRES_EXPLICIT_COLLECTION_AND_CLEANUP=${state.temporary}`);
}
