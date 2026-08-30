import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scope = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scope, '../../../..');
const previous = resolve(scope, '../actual-v1');
const recipe = join(scope, 'recipe');
const sha = value => createHash('sha256').update(value).digest('hex');
const read = target => fs.readFileSync(target, 'utf8');
const save = (target, value) => fs.writeFileSync(target, value, { flag: 'wx' });
const oldSeal = JSON.parse(read(join(previous, 'EVIDENCE-MANIFEST.json')));
assert.equal(sha(read(join(previous, 'EVIDENCE-MANIFEST.json'))), '537bcad586ed13e22d6e1fd49aeeb3924dd4ae65552b1dfe4256a38a6fb936fe');
for (const row of oldSeal.files) assert.equal(sha(fs.readFileSync(join(previous, row.path))), row.sha256);
const original = name => read(join(previous, 'recipe', name));
const changes = [];
function replace(source, before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `EXACT_ADAPTER_ONCE:${label}`);
  changes.push({ label, before, after });
  return source.replace(before, after);
}
const generated = [];
function generatedFile(name, before, after) {
  save(join(recipe, name), after);
  generated.push({ name, originalSha256: sha(before), patchedSha256: sha(after), unchanged: before === after });
}
for (const name of ['io.mjs', 'tool-observer.cjs', 'types-root.ts.data']) generatedFile(name, original(name), original(name));
let preload = original('preload.mjs');
preload = replace(preload,
  "assert.equal(fs.realpathSync(path), path); assert.ok(Object.hasOwn(config.loads, path), `UNBOUND_MODULE:${path}`); return path;",
  "assert.equal(fs.realpathSync(path), path); if (!Object.hasOwn(config.loads, path)) trace({ kind: 'strict-load-allowlist-denial', path, guard: 'Object.hasOwn(config.loads,path)', beforeProductLoad: true }); assert.ok(Object.hasOwn(config.loads, path), `UNBOUND_MODULE:${path}`); return path;",
  'preload-guard-receipt-only');
generatedFile('preload.mjs', original('preload.mjs'), preload);

let cases = original('cases.mjs');
const telemetry = `
function diagnosticOutcome(outcome, sentinel) {
  if (outcome.status === 'pending') return { status: 'pending' };
  if (outcome.status === 'rejected') return { status: 'rejected', sameSentinel: Object.is(outcome.reason, sentinel), reason: encodeReason(outcome.reason) };
  const value = outcome.value;
  return { status: 'fulfilled', exitCode: value?.exitCode, stdout: value?.stdout, stderr: value?.stderr,
    stdoutBase64: value?.stdoutBytes === undefined ? null : Buffer.from(value.stdoutBytes).toString('base64'),
    stderrBase64: value?.stderrBytes === undefined ? null : Buffer.from(value.stderrBytes).toString('base64') };
}
function preserveDiagnostic(kind, observation) {
  (receipt.diagnosticObservations ??= []).push({ kind, ...observation });
  fs.appendFileSync(config.output + '/PRE-ASSERTION-OBSERVATIONS.jsonl', JSON.stringify({ kind, ...observation }) + '\\n');
}
`;
cases = replace(cases, 'function integrity() {', telemetry + '\nfunction integrity() {', 'diagnostic-serialization-no-verdict');
cases = replace(cases,
  'const run = await pending.finish();\n    assertDirectRetirementCollision({ localSignal: pending.signal,',
  `const run = await pending.finish();
    preserveDiagnostic('PC02-direct-retirement', { entered, threw: thrown, sameSentinel: Object.is(observed, pending.signal.reason), before: diagnosticOutcome(before, observed), handler: diagnosticOutcome(run.outcome, observed), childClosed: pending.childClosed, resources: timing.live, registeredCleanupRejections: run.cleanup.filter(row => row.status === 'rejected').length });
    assertDirectRetirementCollision({ localSignal: pending.signal,`,
  'PC02-retain-activation-before-original-assertion');
cases = replace(cases,
  'let childSignal, handlerObservation, childClosed = false;\n  const instance = shell({}, timing); const actual',
  'let childSignal, handlerObservation, childClosed = false;\n  const dispatch = { timeout: 0, child: 0, outer: 0 }; let invokeObservation, handlerSignal;\n  const instance = shell({}, timing); const actual',
  'PC01-observation-state-only');
cases = replace(cases,
  "instance.register({ name: 'timeout', execute(context) { handlerObservation = watch(actual.execute(context)); return handlerObservation.settled.then(row => { if (row.status === 'rejected') throw row.reason; return row.value; }); } }, { replace: true });",
  "instance.register({ name: 'timeout', execute(context) { dispatch.timeout++; handlerSignal = context.signal; handlerObservation = watch(actual.execute(context)); return handlerObservation.settled.then(row => { if (row.status === 'rejected') throw row.reason; return row.value; }); } }, { replace: true });",
  'PC01-actual-timeout-dispatch-counter');
cases = replace(cases,
  "instance.register({ name: 'child', execute(context) { childSignal = context.signal; context.registerCleanup(async () => { await childGate.promise; childClosed = true; }); childEntered.resolve(); return { exitCode: 0 }; } });",
  "instance.register({ name: 'child', execute(context) { dispatch.child++; childSignal = context.signal; context.registerCleanup(async () => { await childGate.promise; childClosed = true; }); childEntered.resolve(); return { exitCode: 0 }; } });",
  'PC01-actual-child-dispatch-counter');
cases = replace(cases,
  "if (outerContext) instance.register({ name: 'outer', execute: context => context.invoke('timeout', ['.001', 'child'], { signal: controller.signal }) });",
  "if (outerContext) instance.register({ name: 'outer', execute(context) { dispatch.outer++; const pending = context.invoke('timeout', ['.001', 'child'], { signal: controller.signal }); invokeObservation = watch(pending); return pending; } });",
  'PC01-observe-raw-invoke-preserve-returned-promise-identity');
cases = replace(cases,
  'childGate.resolve(); const handler = await handlerObservation.settled, outerResult = await outer.settled; assert.equal(childClosed, true);\n  if (collision) assertCallerCollision',
  `childGate.resolve(); const handler = await handlerObservation.settled, outerResult = await outer.settled; assert.equal(childClosed, true);
  preserveDiagnostic('PC01-boundaries', { route: outerContext ? 'borrowed-outer-invoke' : 'root-caller', dispatch: { ...dispatch }, observedOwnReason: encodeReason(observed), callerAborted: controller.signal.aborted, sameCallerSentinel: Object.is(controller.signal.reason, observed), handlerSignalAborted: handlerSignal.aborted, sameHandlerSignalReason: Object.is(handlerSignal.reason, observed), beforeRelease: { handler: diagnosticOutcome(beforeRelease.handler, observed), outer: diagnosticOutcome(beforeRelease.outer, observed) }, handler: diagnosticOutcome(handler, observed), rawInvoke: invokeObservation ? diagnosticOutcome(await invokeObservation.settled, observed) : null, outer: diagnosticOutcome(outerResult, observed), childClosed, resources: timing.live });
  if (collision) assertCallerCollision`,
  'PC01-retain-full-new-boundary-observations-before-unchanged-assertions');
cases = replace(cases,
  "receipt.status = config.caseIds ? (passed ? 'MUTANT_SURVIVED' : 'MUTANT_REJECTED') : (passed ? 'FROZEN_RUNTIME_ASSERTIONS_PASSED' : 'FROZEN_RUNTIME_ASSERTIONS_FAILED');",
  "receipt.status = config.intentionalMutation ? (passed ? 'MUTANT_SURVIVED' : 'MUTANT_REJECTED') : (passed ? 'DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED' : 'DIAGNOSTIC_FROZEN_ASSERTIONS_FAILED');",
  'selected-diagnostic-envelope-not-semantic-rescore');
generatedFile('cases.mjs', original('cases.mjs'), cases);

let executor = original('executor.mjs').split("try {\n  guard('PRE');")[0];
executor = replace(executor, "const bindings = read(join(recipe, 'BINDINGS.json'));", "import { assertRootMissing, assertImportDenied } from './predicates.mjs';\nimport { focusedControls } from './controls.mjs';\n\nconst bindings = read(join(recipe, 'BINDINGS.json'));", 'import-exact-reconciliation-predicates');
executor = replace(executor, "schema: 'timeout-independent-actual-review/1'", "schema: 'timeout-independent-verifier-reconciliation/1'", 'versioned-receipt-schema');
executor = replace(executor,
  "const rows = [['positive', 0, null], ['readonly', 2, 2540], ['array', 2, 2339], ['unknown', 2, 2353], ['number', 2, 2322], ['replace', 2, 2353], ['root', 2, 2305], ['subpath', 2, 2307]];",
  "const rows = [['root', 2, 2724]];", 'only-root-type-correction-not-other-types');
const oldTypeAssertions = executor.slice(executor.indexOf('      assert.equal(result.code, status);'), executor.indexOf('    } catch (error) { record.status'));
executor = replace(executor, oldTypeAssertions, '      assertRootMissing(result);\n', 'exact-root-name-location-message-status-LF-not-keywords');
executor = replace(executor,
  "...(mutation ? { caseIds: [mutation.caseId], intentionalMutation: mutation } : {})",
  "...(mutation ? { caseIds: [mutation.caseId], intentionalMutation: mutation } : { caseIds: ['PC01'] })", 'PC01-only-diagnostics-original-mutant-selection');
const oldRuntimeClassification = executor.slice(executor.indexOf('  if (mutation) {\n    const failed'), executor.indexOf('\n}\nasync function importNegative'));
const runtimeClassification = `  assert.deepEqual(captured.unexecuted, []);
  assert.notEqual(captured.status, 'STOP_NO_RETRY');
  if (mutation) {
    const failed = captured.cases.find(row => row.status === 'FAIL');
    const record = { id: mutation.id, status: 'PASS', actualModuleSha256: mutation.mutantSha256, expectedFailure: mutation.failure, actualFailure: failed?.error, cleanup: captured.cleanup, loads: captured.loadProof, diagnosticObservations: captured.diagnosticObservations };
    try {
      assert.equal(result.code, 1); assert.equal(failed?.id, mutation.caseId); assert.ok(failed.error.text.includes(mutation.failure), 'DESIGNATED_MUTANT_FAILURE:' + mutation.id);
      if (mutation.id === 'M02') {
        const activation = captured.diagnosticObservations.find(row => row.kind === 'PC02-direct-retirement');
        assert.equal(activation.entered, true); assert.equal(activation.threw, true); assert.equal(activation.sameSentinel, true); assert.equal(activation.resources, 0); assert.equal(activation.childClosed, true);
      }
    } catch (error) { record.status = 'FAIL'; record.verifierFailure = { name: error?.name, message: error?.message, stack: error?.stack }; }
    state.mutants.push(record); save(join(raw, mutation.id + '-qualification.json'), record);
  } else {
    state[profile] = captured;
    assert.ok(['DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED', 'DIAGNOSTIC_FROZEN_ASSERTIONS_FAILED'].includes(captured.status));
    assert.equal(result.code, captured.status === 'DIAGNOSTIC_FROZEN_ASSERTIONS_PASSED' ? 0 : 1);
  }`;
executor = replace(executor, oldRuntimeClassification, runtimeClassification, 'mutant-ordinary-failure-record-and-continue-after-closure');
const oldImportNegative = executor.slice(executor.indexOf('async function importNegative('));
const importNegative = `async function importNegative(id, consumer, target, kind) {
  const output = join(raw, id); fs.mkdirSync(output);
  const entry = join(consumer, id + '.mjs'); write(entry, fs.readFileSync(join(recipe, 'negative-import.mjs')));
  const configPath = join(work, id + '-config.json');
  save(configPath, { profile: 'moved', sourceRoot, loads: { [entry]: fileHash(entry) }, targets: {}, trace: join(output, 'module-loads.jsonl') });
  const parent = join(repository, 'tests/commands/timeout-independent-20260828');
  const result = await child(id, ['--permission', '--allow-fs-read=' + parent, '--allow-fs-write=' + scope, '--import', join(recipe, 'preload.mjs'), entry], consumer,
    { TIMEOUT_CONFIG: configPath, TIMEOUT_CONFIG_SHA256: fileHash(configPath), NEGATIVE_TARGET: kind === 'unbound-source' ? pathToFileURL(target).href : target, NEGATIVE_LABEL: target });
  const trace = fs.readFileSync(join(output, 'module-loads.jsonl'), 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
  const record = { id, status: 'PASS', kind, target, childCode: result.code, trace };
  try {
    record.observed = JSON.parse(result.stdout);
    assertImportDenied({ result, observed: record.observed, trace, entry, entrySha256: fileHash(entry), target, kind, packageJson: join(consumer, 'node_modules/virtual-bash/package.json') });
  } catch (error) { record.status = 'FAIL'; record.verifierFailure = { name: error?.name, message: error?.message, stack: error?.stack }; }
  state.controls.push(record); save(join(output, 'QUALIFICATION.json'), record); guard(id + '-POST');
}

`;
executor = replace(executor, oldImportNegative, importNegative, 'full-error-before-exact-guard-specific-parent-predicate');
const oldBody = original('executor.mjs');
const stageStart = oldBody.indexOf('  for (const binary of closure.binaries)');
const stageEnd = oldBody.indexOf("  const build = await tool('build'");
const stageToolsSource = oldBody.slice(stageStart, stageEnd);
executor += `try {
  state.phase = 'focused-controls'; guard('PRE');
  state.focusedControls = focusedControls(); save(join(raw, 'FOCUSED-CONTROLS.json'), state.focusedControls);
  assert.equal(state.focusedControls.length, 28); assert.ok(state.focusedControls.every(row => row.actual === row.expected));
  const archive = fs.readFileSync(join(repository, bindings.sourceArchive.path)); assert.equal(sha(archive), bindings.sourceArchive.sha256); const entries = tarEntries(archive); matchInventory(entries, bindings.inputs);
${stageToolsSource}
  sourceBaseline = tree(sourceRoot);
  const packFile = join(repository, bindings.retainedPack.path); assert.equal(fileHash(packFile), bindings.pack.sha256);
  matchInventory(tarEntries(fs.readFileSync(packFile), true).map(row => ({ ...row, path: row.path.slice(8) })), bindings.packageFiles);
  state.pack = { sha256: fileHash(packFile), members: bindings.packageFiles.length, reproduction: 'BOUND_PRIOR_ACTUAL_NOT_RERUN' };
  const installed = join(work, 'installed'); fs.mkdirSync(installed); write(join(installed, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  state.phase = 'offline-install'; const install = await tool('install', npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', packFile], installed); assert.equal(install.code, 0);
  matchInventory(tree(join(installed, 'node_modules/virtual-bash')), bindings.packageFiles);
  state.phase = 'installed-root-types'; const installedTypes = await types('installed', installed);
  state.phase = 'source-PC01-diagnosis'; await runtime('source', sourceRoot, installedTypes);
  const movedConsumer = join(work, 'physically-moved/consumer'); fs.mkdirSync(join(work, 'physically-moved')); fs.renameSync(installed, movedConsumer); assert.equal(fs.existsSync(installed), false);
  movedRoot = join(movedConsumer, 'node_modules/virtual-bash'); movedBaseline = tree(movedRoot); matchInventory(movedBaseline, bindings.packageFiles);
  fs.unlinkSync(join(movedConsumer, 'tsconfig.json'));
  state.phase = 'moved-root-types'; const movedTypes = await types('moved', movedConsumer);
  state.phase = 'moved-PC01-diagnosis'; await runtime('moved', movedRoot, movedTypes);
  state.phase = 'A09-new-targeted-diagnosis'; await importNegative('A09-new-targeted-diagnosis', movedConsumer, join(repository, 'src/index.ts'), 'unbound-source');
  state.phase = 'A10-public-subpath'; await importNegative('A10-public-subpath', movedConsumer, 'virtual-bash/commands/timeout', 'public-subpath');
  for (const mutation of bindings.mutants) {
    state.phase = mutation.id;
    const mutantRoot = join(work, mutation.id); fs.mkdirSync(mutantRoot);
    for (const row of entries) {
      let bytes = row.body;
      if (row.path === 'src/commands/timeout/index.ts') {
        const source = bytes.toString(), offset = source.lastIndexOf(mutation.before); assert.ok(offset >= 0);
        bytes = Buffer.from(source.slice(0, offset) + mutation.after + source.slice(offset + mutation.before.length)); assert.equal(sha(bytes), mutation.mutantSha256);
      }
      write(join(mutantRoot, row.path), bytes); fs.chmodSync(join(mutantRoot, row.path), row.mode);
    }
    await runtime(mutation.id, mutantRoot, installedTypes, mutation);
    guard(mutation.id + '-AFTER-QUALIFICATION');
  }
  state.phase = 'completed';
  state.status = state.types.every(row => row.status === 'PASS') && state.controls.every(row => row.status === 'PASS') && state.mutants.every(row => row.status === 'PASS')
    ? 'RECONCILIATION_COMPLETE_PC01_BOUNDARY_REVIEW_REQUIRED' : 'RECONCILIATION_COMPLETE_WITH_ADDITIONAL_FINDINGS';
  process.exitCode = 1;
} catch (error) { state.status = 'STOP_NO_RETRY'; state.failure = { name: error?.name, message: error?.message, stack: error?.stack }; process.exitCode = 1; }
finally {
  try { guard('FINAL'); state.integrity = 'PASS'; } catch (error) { state.integrity = { message: error?.message, stack: error?.stack }; state.status = 'STOP_NO_RETRY'; process.exitCode = 1; }
  try { for (const record of state.children) if (record.pid) absent(record.pid); state.allChildrenReaped = true; } catch (error) { state.allChildrenReaped = false; state.cleanupFailure = String(error); process.exitCode = 1; }
  state.finishedAt = new Date().toISOString(); save(join(raw, 'RESULT.json'), state);
  console.log(JSON.stringify({ status: state.status, phase: state.phase, types: state.types.map(row => row.status), controls: state.controls.map(row => ({ id: row.id, status: row.status })), mutants: state.mutants.map(row => ({ id: row.id, status: row.status })), children: state.children.length, reaped: state.allChildrenReaped, failure: state.failure }));
}
`;
generatedFile('executor.mjs', original('executor.mjs'), executor);
let launch = original('launch.mjs');
launch = replace(launch, 'actual-v1/recipe/${name}', 'verifier-reconciliation-v1/recipe/${name}', 'authenticate-new-committed-recipe-not-old-patched-bytes');
generatedFile('launch.mjs', original('launch.mjs'), launch);
const bindings = JSON.parse(original('BINDINGS.json'));
bindings.schema = 'timeout-independent-verifier-reconciliation-bindings/1';
bindings.preparedAt = new Date().toISOString();
bindings.retainedPack = { path: relative(repository, join(previous, 'evidence/reproduced-package.tgz')), sha256: bindings.pack.sha256 };
for (const row of [...oldSeal.files, { path: 'EVIDENCE-MANIFEST.json', sha256: sha(read(join(previous, 'EVIDENCE-MANIFEST.json'))) }]) bindings.protectedRows.push({ path: relative(repository, join(previous, row.path)), sha256: row.sha256 });
bindings.protectedRows.push({ path: relative(repository, fileURLToPath(import.meta.url)), sha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))) });
save(join(recipe, 'BINDINGS.json'), JSON.stringify(bindings, null, 2) + '\n');
save(join(recipe, 'ADAPTER.json'), JSON.stringify({ schema: 'timeout-independent-explicit-verifier-adapter/1', originalRecipeCommit: '289d00d253136032c1bd6b078662ba5f37e39a3d', originalEvidenceCommit: 'a8ebf811c57fbb1084ccfe9dd34a8265f5dff69a', generated, replacements: changes,
  executorScopeDelta: 'Retained original supervisor/tool/type-load/runtime-load/closure functions; select root types plus PC01 diagnostics, authenticated retained package install/move instead of build/pack rerun, new A09 receipt, original A10 and both mutants; continue ordinary control classification failures only after guards and reaping.',
  assertions: 'PC01 and PC02 assertion bodies unchanged; telemetry only before them. Only root-negative type predicate changes from TS2305 keyword to exact TS2724 complete stdout. A09 guard-specific classification is separately versioned, not generic ERR_ASSERTION acceptance.' }, null, 2) + '\n');
const files = {};
for (const name of fs.readdirSync(recipe).sort()) { assert.notEqual(name, 'AGENTS.md'); assert.ok(fs.lstatSync(join(recipe, name)).isFile()); files[name] = sha(fs.readFileSync(join(recipe, name))); }
const manifest = { schema: 'timeout-independent-verifier-reconciliation-recipe/1', sealedAt: new Date().toISOString(), candidate: bindings.candidate, baseline: bindings.baseline,
  chronology: 'Post-old-source verifier reconciliation; new F22 candidate not received/inspected/bound. Original freezes and first result unchanged.',
  children: 9, focusedControls: 28, typePayloads: ['root-negative-only, installed and moved'], productDiagnostics: ['PC01 source', 'PC01 moved'], tail: ['A09 newly captured exact-guard diagnosis', 'A10 actual public-export denial', 'M01', 'M02'], semanticCorrectionPC01: false, retries: 0, native: 0, safeJS: 0, files };
save(join(recipe, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: 'RECIPE_PREPARED_NO_PRODUCT_EXECUTION', files: Object.keys(files).length + 1, manifestSha256: sha(read(join(recipe, 'MANIFEST.json'))), adapters: changes.length }));
