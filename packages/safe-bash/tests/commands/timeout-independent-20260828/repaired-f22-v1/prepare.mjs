import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, fileHash, read, tree, tarEntries, matchInventory, safe } from '../actual-v1/recipe/io.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), recipe = join(scope, 'recipe');
const repository = resolve(scope, '../../../..'), previous = resolve(scope, '../actual-v1'), reconciliation = resolve(scope, '../verifier-reconciliation-v1');
const candidate = 'a23867d6a42e1cb2f2e7278cf22061737a4bea9d', baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const author = 'tests/commands/timeout-author-20260828/repair-f22-v1', evidence = `${author}/evidence-v1`;
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
assert.equal(fileHash(process.execPath), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
assert.equal(fileHash(git), '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
let gitReturns = 0;
const gitRead = (...args) => { const result = execFileSync(git, ['--no-replace-objects', '--no-optional-locks', '-C', repository, ...args], { timeout: 15000, maxBuffer: 32 * 1024 ** 2, env: { PATH: '/usr/bin:/bin', HOME: scope, TMPDIR: scope, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); gitReturns++; return result; };
assert.equal(fileHash(join(reconciliation, 'EVIDENCE-MANIFEST.json')), '6e1ab7ac0927d489d3941795038e9fd2a3ae2199b25b3f75654aeb2200795a91');
const priorSeal = read(join(reconciliation, 'EVIDENCE-MANIFEST.json'));
for (const row of priorSeal.files) assert.equal(fileHash(join(reconciliation, row.path)), row.sha256);
const authorSealPath = join(repository, evidence, 'EVIDENCE-SEAL.json');
assert.equal(fileHash(authorSealPath), '638f9e1ca1f0fb61477c1e556b891437d393b0640a69e894fb292d2320acd9c4');
const authorSeal = read(authorSealPath);
matchInventory(tree(join(repository, evidence)).filter(row => row.path !== 'EVIDENCE-SEAL.json'), authorSeal.files);
assert.equal(authorSeal.files.length, 41);
assert.deepEqual(gitRead('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).toString().trim().split('\n'), ['src/commands/timeout/scheduler.ts']);
const sourceManifest = read(join(repository, evidence, 'SOURCE-MANIFEST.json'));
assert.equal(sourceManifest.baseline, baseline); assert.equal(sourceManifest.repairSourceCommit, candidate);
const listing = commit => gitRead('ls-tree', '-r', commit).toString().trim().split('\n').map(line => { const [header, path] = line.split('\t'), [mode, type, blob] = header.split(' '); return { path, mode, type, blob }; });
const selected = listing(baseline).filter(row => (row.path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(row.path)) && !row.path.startsWith('src/commands/timeout/'));
selected.push(...listing(candidate).filter(row => row.path.startsWith('src/commands/timeout/')));
assert.equal(selected.length, 268); assert.equal(sourceManifest.entries.length, 268);
for (const row of sourceManifest.entries) {
  safe(row.path); const actual = selected.find(entry => entry.path === row.path); assert.ok(actual);
  assert.equal(actual.type, 'blob'); assert.equal(actual.mode, row.mode); assert.equal(actual.blob, row.blob);
  const bytes = gitRead('cat-file', 'blob', row.blob); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
}
const archivePath = `${evidence}/SOURCE.tar`, packagePath = `${evidence}/package/virtual-bash-0.0.0.tgz`;
assert.equal(fileHash(join(repository, archivePath)), 'ee7fae20f2c3f99839893afe31b93aa4b6633e1baa36cfbde465e0394161de56');
assert.equal(fileHash(join(repository, packagePath)), 'e6f42dbb063044c0a0d9eaa3029ee9ef0b9ed26aabafd42c9346b18e1901c80c');
const archive = tarEntries(fs.readFileSync(join(repository, archivePath))); matchInventory(archive, sourceManifest.entries);
const packed = tarEntries(fs.readFileSync(join(repository, packagePath)), true); assert.equal(packed.length, 857);
for (const row of packed) assert.ok(row.path.startsWith('package/'));
const oldBindings = read(join(previous, 'recipe/BINDINGS.json'));
const differences = sourceManifest.entries.filter(row => oldBindings.inputs.find(old => old.path === row.path)?.sha256 !== row.sha256);
assert.deepEqual(differences.map(row => row.path), ['src/commands/timeout/scheduler.ts']);
const scheduler = archive.find(row => row.path === 'src/commands/timeout/scheduler.ts');
const reverted = scheduler.body.toString().replace('  receiver: performance,', '  receiver: undefined,');
assert.notEqual(reverted, scheduler.body.toString());
assert.equal(sha(reverted), 'b6ba0e2bf22051f4032686a58821bddcdb211faa918beac4ec004f4d46ca00e8');
const bindings = { ...oldBindings, schema: 'timeout-independent-repaired-binding/1', preparedAt: new Date().toISOString(), candidate,
  sourceArchive: { path: archivePath, sha256: fileHash(join(repository, archivePath)), bytes: fs.statSync(join(repository, archivePath)).size },
  pack: { path: packagePath, sha256: fileHash(join(repository, packagePath)), bytes: fs.statSync(join(repository, packagePath)).size, members: packed.length },
  inputs: sourceManifest.entries, packageFiles: packed.map(({ path, mode, bytes, sha256 }) => ({ path: path.slice(8), mode, bytes, sha256 })),
  protectedRows: read(join(reconciliation, 'recipe/BINDINGS.json')).protectedRows,
  staticProof: { ...oldBindings.staticProof, sourceCommit: candidate, sourceUnchangedFrom: oldBindings.candidate, derivation: 'Original independent scalar-loop proof retained on byte-identical duration.ts; receiver-only repair does not modify parser.' },
  priorBindings: { candidate: oldBindings.candidate, sourceArchiveSha256: oldBindings.sourceArchive.sha256, packSha256: oldBindings.pack.sha256, schedulerSha256: 'b6ba0e2bf22051f4032686a58821bddcdb211faa918beac4ec004f4d46ca00e8' } };
for (const row of [...priorSeal.files, { path: 'EVIDENCE-MANIFEST.json', sha256: fileHash(join(reconciliation, 'EVIDENCE-MANIFEST.json')) }]) bindings.protectedRows.push({ path: relative(repository, join(reconciliation, row.path)), sha256: row.sha256 });
for (const row of [...authorSeal.files, { path: 'EVIDENCE-SEAL.json', sha256: fileHash(authorSealPath) }]) bindings.protectedRows.push({ path: `${evidence}/${row.path}`, sha256: row.sha256 });
for (const name of ['HANDOFF.md', 'FREEZE.json', 'PREPATCH-CAPTURE.json', 'PREPATCH-RUNS.json', 'EVIDENCE-VERIFICATION.json']) bindings.protectedRows.push({ path: `${author}/${name}`, sha256: fileHash(join(repository, author, name)) });
bindings.protectedRows.push({ path: relative(repository, fileURLToPath(import.meta.url)), sha256: fileHash(fileURLToPath(import.meta.url)) });
bindings.mutants = oldBindings.mutants.map(row => ({ ...row, path: 'src/commands/timeout/index.ts' }));
bindings.mutants.push({ id: 'M03', path: 'src/commands/timeout/scheduler.ts', caseId: 'F22', basis: 'Exact receiver repair reversion', before: '  receiver: performance,', after: '  receiver: undefined,', failure: '125 !== 7', originalSha256: scheduler.sha256, mutantSha256: sha(reverted), bytes: Buffer.byteLength(reverted), selection: 'last exact occurrence only; isolated owned source tree; exact old scheduler hash' });
for (const mutation of bindings.mutants) {
  const source = archive.find(row => row.path === mutation.path).body.toString(), offset = source.lastIndexOf(mutation.before);
  assert.ok(offset >= 0); assert.equal(sha(source), mutation.originalSha256);
  assert.equal(sha(source.slice(0, offset) + mutation.after + source.slice(offset + mutation.before.length)), mutation.mutantSha256);
}
for (const row of bindings.protectedRows) assert.equal(fileHash(join(repository, row.path)), row.sha256);
const text = (root, name) => fs.readFileSync(join(root, 'recipe', name), 'utf8');
const save = (name, value) => fs.writeFileSync(join(recipe, name), value, { flag: 'wx' });
const generated = [], replacements = [];
function replace(source, before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `EXACT_ADAPTER_ONCE:${label}`);
  replacements.push({ label, before, after }); return source.replace(before, after);
}
function output(name, before, after, origin) {
  save(name, after); generated.push({ name, origin, originalSha256: sha(before), patchedSha256: sha(after), unchanged: before === after });
}
for (const name of ['io.mjs', 'tool-observer.cjs', ...fs.readdirSync(join(previous, 'recipe')).filter(name => name.startsWith('types-') && name.endsWith('.data'))]) output(name, text(previous, name), text(previous, name), '289d00d2');
for (const name of ['predicates.mjs', 'controls.mjs', 'negative-import.mjs', 'preload.mjs']) output(name, text(reconciliation, name), text(reconciliation, name), '7e6a0b78');
output('negative-hash.mjs', text(previous, 'negative-import.mjs'), text(previous, 'negative-import.mjs'), '289d00d2');
let cases = text(reconciliation, 'cases.mjs');
cases = replace(cases, "import { join } from 'node:path';", "import { join } from 'node:path';\nimport { assertBorrowedCollision } from './borrowed-boundary.mjs';", 'approved-borrowed-predicate-import');
const callerAssertion = "  if (collision) assertCallerCollision({ localSignal: childSignal, callerSignal: controller.signal, observedOwnReason: observed, beforeRelease, handler, outer: outerResult, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });";
cases = replace(cases, callerAssertion,
  `  if (collision && outerContext) assertBorrowedCollision({ localSignal: childSignal, callerSignal: controller.signal, observedOwnReason: observed, beforeRelease, handler, rawInvoke: await invokeObservation.settled, dispatch, outer: outerResult, selectedChildClosed: true, retirementSettled: true, outstandingOwnedResources: timing.live, rejectionsObserved: true });
${callerAssertion.replace('if (collision)', 'else if (collision)')}`, 'only-approved-borrowed-boundary-root-caller-assertion-retained');
cases = replace(cases,
  'rejected({ outcome: handler }, controller.signal.reason); rejected({ outcome: outerResult }, controller.signal.reason);',
  'rejected({ outcome: handler }, controller.signal.reason); if (!outerContext) rejected({ outcome: outerResult }, controller.signal.reason);',
  'do-not-reassert-rejected-outer-after-approved-borrowed-mapping');
cases = replace(cases,
  "returned(await execute(['1', 'child'], {}, { invoke: async () => ({ exitCode: 7 }) }), 7);",
  `const realDefault = await execute(['1', 'child'], {}, { invoke: async () => ({ exitCode: 7 }) });
    preserveDiagnostic('F22-default-before-assertion', { outcome: diagnosticOutcome(realDefault.outcome), stdoutBase64: realDefault.stdout().toString('base64'), stderrBase64: realDefault.stderr().toString('base64'), timeoutResourcesBefore: before });
    returned(realDefault, 7);`, 'F22-default-result-bytes-retained-before-unchanged-status-assertion');
const resolverLine = "for (const [source, expected] of [['unknown-fixture-command', 127], ['/unsupported-directory', 126]]) { const baseline = await other.exec(source), wrapped = await other.exec(`timeout 0 ${source}`); assert.equal(baseline.exitCode, expected); assert.equal(wrapped.exitCode, expected); assert.equal(wrapped.stderr, baseline.stderr); assert.equal(wrapped.stdout, baseline.stdout); } await other.dispose();";
cases = replace(cases, resolverLine,
  "for (const [source, expected] of [['unknown-fixture-command', 127], ['/unsupported-directory', 126]]) { const baseline = await other.exec(source), wrapped = await other.exec(`timeout 0 ${source}`); preserveDiagnostic('F22-resolver-before-assertion', { source, expected, baseline: diagnosticOutcome({ status: 'fulfilled', value: baseline }), wrapped: diagnosticOutcome({ status: 'fulfilled', value: wrapped }) }); assert.equal(baseline.exitCode, expected); assert.equal(wrapped.exitCode, expected); assert.equal(wrapped.stderr, baseline.stderr); assert.equal(wrapped.stdout, baseline.stdout); } await other.dispose();",
  'F22-trailing-resolver-observations-no-input-or-assertion-change');
cases = replace(cases,
  "receipt.status = config.intentionalMutation ? (passed ? 'MUTANT_SURVIVED' : 'MUTANT_REJECTED') : (passed ? 'DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED' : 'DIAGNOSTIC_FROZEN_ASSERTIONS_FAILED');",
  "receipt.status = config.intentionalMutation ? (passed ? 'MUTANT_SURVIVED' : 'MUTANT_REJECTED') : (passed ? 'FROZEN_RUNTIME_ASSERTIONS_PASSED' : 'FROZEN_RUNTIME_ASSERTIONS_FAILED');", 'full-qualified-layout-envelope-on-new-candidate');
output('cases.mjs', text(reconciliation, 'cases.mjs'), cases, '7e6a0b78');

const fullExecutor = text(previous, 'executor.mjs'), reconciledExecutor = text(reconciliation, 'executor.mjs');
let executor = fullExecutor.split("try {\n  guard('PRE');")[0];
executor = replace(executor, "const bindings = read(join(recipe, 'BINDINGS.json'));", "import { assertRootMissing, assertImportDenied } from './predicates.mjs';\nimport { focusedControls } from './controls.mjs';\nimport { boundaryControls } from './boundary-controls.mjs';\n\nconst bindings = read(join(recipe, 'BINDINGS.json'));", 'exact-approved-and-boundary-control-imports');
executor = replace(executor, "schema: 'timeout-independent-actual-review/1'", "schema: 'timeout-independent-repaired-full-review/1'", 'separate-repaired-candidate-result');
executor = replace(executor, "['root', 2, 2305]", "['root', 2, 2724]", 'root-only-TS2724-code');
executor = replace(executor,
  '      assert.equal(result.code, status); assert.equal(result.signal, null); assert.equal(result.stderr, \'\');',
  '      if (name === \'root\') assertRootMissing(result);\n      assert.equal(result.code, status); assert.equal(result.signal, null); assert.equal(result.stderr, \'\');', 'root-only-full-exact-diagnostic-in-addition-to-original-type-guards');
const oldClassification = executor.slice(executor.indexOf('  if (mutation) {\n    const failed'), executor.indexOf('\n}\nasync function importNegative'));
let classification = reconciledExecutor.slice(reconciledExecutor.indexOf('  assert.deepEqual(captured.unexecuted, []);'), reconciledExecutor.indexOf('\n}\nasync function importNegative'));
classification = classification.replaceAll('DIAGNOSTIC_FROZEN_ASSERTIONS_', 'FROZEN_RUNTIME_ASSERTIONS_');
classification = replace(classification,
  "      if (mutation.id === 'M02') {",
  `      if (mutation.id === 'M03') {
        const observation = captured.diagnosticObservations.find(row => row.kind === 'F22-default-before-assertion');
        assert.equal(observation.outcome.status, 'fulfilled'); assert.equal(observation.outcome.exitCode, 125);
        assert.equal(observation.stdoutBase64, ''); assert.equal(observation.stderrBase64, bindings.diagnostics.find(row => row.label === 'timer-setup-failed').base64);
      }
      if (mutation.id === 'M02') {`, 'receiver-reversion-designated-real-default-failure');
executor = replace(executor, oldClassification, classification, 'classified-mutants-continue-after-safe-ordinary-failure');
const oldNegative = executor.slice(executor.indexOf('async function importNegative('));
let legacyNegative = oldNegative.replace('async function importNegative(', 'async function legacyImportNegative(').replace("'negative-import.mjs'", "'negative-hash.mjs'");
const legacyAssertions = legacyNegative.slice(legacyNegative.indexOf('  assert.equal(result.code, 0);'));
legacyNegative = replace(legacyNegative, legacyAssertions,
  `  const record = { id, status: 'PASS', childCode: result.code };
  try {
    assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const observed = JSON.parse(result.stdout); assert.equal(observed.code, code);
    const trace = fs.readFileSync(join(output, 'module-loads.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
    assert.equal(trace.filter(row => row.kind === 'actual-module-load').length, 1); assert.equal(trace.find(row => row.kind === 'actual-module-load').path, entry);
    record.observed = observed; record.actualNegativeHelperLoad = true; record.productModuleLoads = 0;
  } catch (error) { record.status = 'FAIL'; record.verifierFailure = { name: error?.name, message: error?.message, stack: error?.stack }; }
  state.controls.push(record); save(join(output, 'QUALIFICATION.json'), record); guard(id + '-POST');
}

`, 'A08-original-designated-rejection-ordinary-classification-not-stop');
const targetedNegative = reconciledExecutor.slice(reconciledExecutor.indexOf('async function importNegative('), reconciledExecutor.indexOf("try {\n  state.phase = 'focused-controls'"));
executor = replace(executor, oldNegative, legacyNegative + targetedNegative, 'retain-A08-plus-accepted-exact-A09-A10');
let body = fullExecutor.slice(fullExecutor.indexOf("try {\n  guard('PRE');"));
body = replace(body, "  guard('PRE');", "  guard('PRE');\n  state.focusedControls = [...focusedControls(), ...boundaryControls()]; save(join(raw, 'FOCUSED-CONTROLS.json'), state.focusedControls); assert.equal(state.focusedControls.length, 48); assert.ok(state.focusedControls.every(row => row.actual === row.expected));", '48-prerequisite-controls-durable-before-assertion');
body = replace(body,
  "  rejectControl('A12-wrong-baseline', () => assert.equal('0'.repeat(40), bindings.baseline));",
  `  rejectControl('A12-wrong-baseline', () => assert.equal('0'.repeat(40), bindings.baseline));
  rejectControl('A13-old-scheduler-hash', () => assert.equal(sha(entries.find(row => row.path === 'src/commands/timeout/scheduler.ts').body), bindings.priorBindings.schedulerSha256));
  rejectControl('A14-old-source-archive-hash', () => assert.equal(sha(archive), bindings.priorBindings.sourceArchiveSha256));
  rejectControl('A15-old-package-hash', () => assert.equal(fileHash(join(repository, bindings.pack.path)), bindings.priorBindings.packSha256));`, 'old-binding-rejection-specific-to-repair');
body = replace(body,
  "  await importNegative('A08-wrong-module-hash', movedConsumer, 'timeout-under-review', 'ERR_ASSERTION', 'MODULE_HASH_MISMATCH', true);",
  "  await legacyImportNegative('A08-wrong-module-hash', movedConsumer, 'timeout-under-review', 'ERR_ASSERTION', 'MODULE_HASH_MISMATCH', true);", 'A08-original-helper');
body = replace(body,
  "  await importNegative('A09-source-permission-denial', movedConsumer, pathToFileURL(join(repository, 'src/index.ts')).href, 'ERR_ACCESS_DENIED');",
  "  await importNegative('A09-exact-unbound-source', movedConsumer, join(repository, 'src/index.ts'), 'unbound-source');", 'approved-A09-guard-specific-not-permission-claim');
body = replace(body,
  "  await importNegative('A10-public-subpath-absent', movedConsumer, 'virtual-bash/commands/timeout', 'ERR_PACKAGE_PATH_NOT_EXPORTED');",
  "  await importNegative('A10-public-subpath-absent', movedConsumer, 'virtual-bash/commands/timeout', 'public-subpath');", 'exact-public-subpath-rejection');
body = replace(body, "if (row.path === 'src/commands/timeout/index.ts')", 'if (row.path === mutation.path)', 'exact-declared-mutant-path-including-scheduler-reversion');
body = replace(body,
  "  state.status = [state.source, state.moved].every(row => row.status === 'FROZEN_RUNTIME_ASSERTIONS_PASSED') && state.types.every(row => row.status === 'PASS') ? 'SCOPED_TIMEOUT_MODULE_REVIEW_PASSED' : 'SCOPED_TIMEOUT_MODULE_REVIEW_FINDINGS';",
  "  state.status = [state.source, state.moved].every(row => row.status === 'FROZEN_RUNTIME_ASSERTIONS_PASSED') && state.types.every(row => row.status === 'PASS') && state.controls.every(row => row.rejected === true || row.status === 'PASS') && state.mutants.length === 3 && state.mutants.every(row => row.status === 'PASS') ? 'SCOPED_TIMEOUT_MODULE_REVIEW_PASSED' : 'SCOPED_TIMEOUT_MODULE_REVIEW_FINDINGS';", 'all-required-guards-and-mutants-part-of-repaired-verdict');
executor += body;
output('executor.mjs', fullExecutor, executor, '289d00d2 plus accepted7e6a0b78 components');
let launch = text(previous, 'launch.mjs');
launch = replace(launch, 'actual-v1/recipe/${name}', 'repaired-f22-v1/recipe/${name}', 'authenticate-current-committed-recipe');
launch = replace(launch, "assert.equal(bindings.candidate, '9ed9a0f14d12758713a8dc42be1ff75f0c87a36f');", `assert.equal(bindings.candidate, '${candidate}');`, 'authenticate-exact-repaired-candidate');
output('launch.mjs', text(previous, 'launch.mjs'), launch, '289d00d2');
save('BINDINGS.json', JSON.stringify(bindings, null, 2) + '\n');
save('ADAPTER.json', JSON.stringify({ schema: 'timeout-independent-approved-repaired-adapter/1', originalRecipeCommit: '289d00d253136032c1bd6b078662ba5f37e39a3d', reconciliationRecipeCommit: '7e6a0b781a2d0cb9e1bc7b0dd02ee973cd857504', approvedProposalEvidence: 'cfd0e63399f0362befac1f1b6e9f64931a77a365', generated, replacements,
  rootAuthority: 'Explicit user approval of exact PC01 borrowed split, root-caller unchanged, TS2724 and exact A09 guard; no product API change.',
  completeLoop: 'Original32+PC01+PC02 order; full70 numeric/14 diagnostic requirements; F22 input/assertions unchanged and trailing checks required; both layouts and all8 types.' }, null, 2) + '\n');
const packageChanges = bindings.packageFiles.filter(row => oldBindings.packageFiles.find(old => old.path === row.path)?.sha256 !== row.sha256).map(row => ({ path: row.path, before: oldBindings.packageFiles.find(old => old.path === row.path)?.sha256, after: row.sha256 }));
save('SOURCE-REVIEW.json', JSON.stringify({ schema: 'timeout-independent-receiver-only-static-review/1', reviewedAt: new Date().toISOString(), candidate, baseline, exactCommitChangedPaths: ['src/commands/timeout/scheduler.ts'], selectedInputs: 268, differences, repair: { before: '  receiver: undefined,', after: '  receiver: performance,', repairedSchedulerSha256: scheduler.sha256, reversionSha256: sha(reverted) }, otherThreeModuleFilesUnchanged: true, authorEvidenceFilesAuthenticated: 41, synchronousGitNaturalReturns: gitReturns, packageChanges, conclusion: 'Receiver-only source change matches F22 defect; no runtime/default/public export delta. Actual independent qualification still required.', productExecuted: false }, null, 2) + '\n');
const files = {};
for (const name of fs.readdirSync(recipe).sort()) { assert.notEqual(name, 'AGENTS.md'); assert.ok(fs.lstatSync(join(recipe, name)).isFile()); files[name] = fileHash(join(recipe, name)); }
save('MANIFEST.json', JSON.stringify({ schema: 'timeout-independent-repaired-complete-recipe/1', sealedAt: new Date().toISOString(), candidate, baseline,
  chronology: 'Source inspected before this seal; original pre-code freeze and approved reconciliation remain distinct and unchanged.',
  originalFamilies: 32, holdouts: 2, numericPerLayout: 70, diagnosticLabelsPerLayout: 14, typesPerLayout: 8, layouts: ['source', 'installed-physically-moved-internal'], focusedControls: 48, admissionAndLoadGuards: 15, productMutants: 3, asynchronousChildren: 27, retries: 0, native: 0, safeJS: 0, files }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'REPAIRED_RECIPE_PREPARED_NO_EXECUTION', candidate, selectedInputs: 268, authorEvidenceFiles: 41, packageChanges, manifestSha256: fileHash(join(recipe, 'MANIFEST.json')), files: Object.keys(files).length + 1, adapters: replacements.length, gitReturns }));
