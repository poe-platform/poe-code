import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base, candidate, capture, environment, evidence, frozen, git, inventory, load, node, productRevision, repository, save, scratch, sha } from './review.mjs';

Object.assign(process.env, environment);
const account = (await load(base + 'account.mjs')).account;
const result = JSON.parse(readFileSync(join(evidence, 'reporter-after-input.json')));
const output = readFileSync(join(evidence, 'reporter-after-input.stdout'), 'utf8');
const observed = account(output);
assert.equal(result.status, 0); assert.equal(observed.reconciled, false);
const repaired = { id: 'permission-tap-flag-after-input', group: 'permission', expected: 'reject', observed: 'reject', status: 'PASS', method: 'actual-child-and-candidate-account', target: base + 'account.mjs#account', observation: { commandReceipt: 'reporter-after-input.json', output, accounting: observed }, supersedes: 'permission-tap-flag-after-input.json', correction: 'Original adapter accessed accounting before initialization. Actual child execution was already preserved; now evaluated with candidate account unchanged. Original NOTEXECUTED remains in evidence.' };
save('permission-tap-flag-after-input-retry.json', repaired);
const correctReporter = capture('reporter-before-input', node, ['--permission', '--allow-fs-read=' + join(scratch, 'runtime-controls/consumer'), '--test-reporter=tap', join(scratch, 'runtime-controls/consumer/fixture.test.mjs')]);
assert.equal(correctReporter.status, 0); assert.equal(account(correctReporter.stdout).reconciled, true);
const policy = JSON.parse(readFileSync(join(candidate, base, 'combined-8670ebe8/policy.json')));
const treeAsset = JSON.parse(readFileSync(join(candidate, 'tests/commands/filesystem-inspection-stress/tree/EXTERNAL-ARTIFACTS.json'))).artifacts.find(row => row.externalBasename === 'tree');
const native = await load(base + 'preflight-repair/preflight.mjs');
const requirements = policy.native.map(row => row.name === 'rg' ? { ...row, originEnv: 'RG_NATIVE_BIN' } : row);
const supplied = { RG_NATIVE_BIN: join(scratch, 'independent-controls/recovered-rg'), TREE_NATIVE_BIN: treeAsset.externalPath };
const availability = native.assessNative(requirements, repository, supplied);
save('native49-availability.json', { ...availability, environment: supplied, scope: 'Hash/mode presence only at explicit policy origins, not a native semantic suite; all expected hashes unchanged. Expr/du extensions are not part of these49.' });
assert.equal(availability.issues.length, 0); assert.equal(availability.assets.length, 49);
const cleanupSource = join(scratch, 'runtime-controls/source');
const cleanupPaths = ['tests/shell/invocation-cleanup-public.test.ts', 'tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs', 'tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'];
for (const path of cleanupPaths) { mkdirSync(join(cleanupSource, path, '..'), { recursive: true }); writeFileSync(join(cleanupSource, path), git(['show', productRevision + ':' + path]), { flag: 'wx' }); }
const cleanupProgram = join(scratch, 'runtime-controls/cleanup-binding.mjs');
const cleanupCode = `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {captureInputs,assertCommittedInputs} from './source/tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts';const expected=JSON.parse(readFileSync(${JSON.stringify(join(scratch, 'independent-controls/profile/cleanup-expected.json'))}));const capture=await captureInputs(${JSON.stringify(cleanupSource)});assert.equal(expected.revision,${JSON.stringify(productRevision)});assert.equal(Object.keys(capture.files).length,244);assertCommittedInputs(capture,expected);const controls=[];for(const kind of ['missing','stale','swapped']){const changed=structuredClone(expected),first=Object.keys(changed.files)[0];if(kind==='missing')delete changed.files[first];if(kind==='stale')changed.files[first]='0'.repeat(64);if(kind==='swapped'){changed.files['src/unapproved.ts']=changed.files[first];delete changed.files[first];}assert.throws(()=>assertCommittedInputs(capture,changed));controls.push(kind);}console.log(JSON.stringify({revision:expected.revision,tree:expected.tree,files:capture.files,controls,workerExecutions:0,scope:'Actual cleanup binding helper capture/assertion, not opaque host-work or universal cleanup guarantee'}));`;
writeFileSync(cleanupProgram, cleanupCode, { flag: 'wx' }); save('cleanup-binding-driver-source.json', { source: cleanupCode, sha256: sha(cleanupCode), inputs: cleanupPaths.map(path => ({ path, revision: productRevision, sha256: sha(readFileSync(join(cleanupSource, path))) })) });
const binding = capture('actual-cleanup-binding', node, ['--import', join(cleanupSource, 'node_modules/tsx/dist/loader.mjs'), cleanupProgram], { cwd: cleanupSource }); assert.equal(binding.status, 0);
const runtimeRoot = join(scratch, 'runtime-controls');
const guardEnvironment = JSON.parse(readFileSync(join(evidence, 'guarded-runtime-probe.json'))).environment;
const originalSource = join(cleanupSource, 'src/commands/env-split.ts');
const guards = [];
for (const [name, code] of [
  ['guard-outside-import', `await import(${JSON.stringify(join(repository, 'src/index.ts'))})`],
  ['guard-compiled-source-fallback', `await import('./src/commands/execution.js')`],
]) {
  if (name === 'guard-compiled-source-fallback') writeFileSync(join(cleanupSource, 'src/commands/execution.js'), 'export {};\n', { flag: 'wx' });
  const logs = join(runtimeRoot, name); mkdirSync(logs);
  const captured = capture(name, node, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: cleanupSource, env: { ...guardEnvironment, FULL_GATE_IMPORTS: logs } });
  assert.equal(captured.status, 1); assert.match(captured.stderr, name === 'guard-outside-import' ? /FROZEN_IMPORT_OUTSIDE/ : /Frozen env compiled-source fallback/); guards.push(captured);
}
const expectedWrong = join(runtimeRoot, 'wrong-expected.json'), expected = JSON.parse(readFileSync(guardEnvironment.FULL_GATE_EXPECTED)); expected['src/commands/env-split.ts'] = '0'.repeat(64); writeFileSync(expectedWrong, JSON.stringify(expected));
const staleGuard = capture('guard-stale-source-binding', node, ['--import', 'tsx', '--input-type=module', '-e', `await import('./src/commands/env-split.ts')`], { cwd: cleanupSource, env: { ...guardEnvironment, FULL_GATE_EXPECTED: expectedWrong, FULL_GATE_IMPORTS: join(runtimeRoot, 'stale-guard-imports') } });
assert.equal(staleGuard.status, 1); assert.match(staleGuard.stderr, /Frozen env source bytes/); guards.push(staleGuard); save('guard-negative-summary.json', guards);
const supervisor = await load(base + 'supervise.mjs');
const overflow = await supervisor.supervise(node, ['--input-type=module', '-e', `process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000);`], { cwd: runtimeRoot, env: environment, stdout: join(evidence, 'supervisor-overflow.stdout'), stderr: join(evidence, 'supervisor-overflow.stderr'), maxOutputBytes: 100, timeoutMs: 10000 });
save('supervisor-overflow.json', overflow); assert.equal(overflow.outputExceeded, true); assert.equal(overflow.clean, false); assert.deepEqual(overflow.survivors, []);
const boundary = JSON.parse(readFileSync(join(frozen, 'boundary.json')));
const candidateReferences = [base + 'runtime-profile-20260827/profile.mjs', base + 'combined-8670ebe8/import-guard.mjs', base + 'account.mjs', base + 'supervise.mjs', 'scripts/verify-current-consumers.mjs', 'scripts/typecheck-consumers.mjs', 'tests/plugins/qualified-current-release/inventory-check.mjs', 'tests/plugins/qualified-current-release/runtime-coverage.mjs', ...cleanupPaths];
save('dependency-revision-bindings.json', candidateReferences.map(path => ({ path, revision: cleanupPaths.includes(path) ? productRevision : '522e8e273573517ab8b854636bdd4589ee696c28', latestCommit: git(['log', '-1', '--format=%H', cleanupPaths.includes(path) ? productRevision : '522e8e273573517ab8b854636bdd4589ee696c28', '--', path]).toString().trim(), sha256: sha(git(['show', (cleanupPaths.includes(path) ? productRevision : '522e8e273573517ab8b854636bdd4589ee696c28') + ':' + path])) })));
const definitions = JSON.parse(readFileSync(join(frozen, 'cases.json'))).cases;
const matrix = definitions.map(definition => {
  const receipt = definition.id === repaired.id ? 'permission-tap-flag-after-input-retry.json' : definition.id + '.json';
  const actual = JSON.parse(readFileSync(join(evidence, receipt))); assert.equal(actual.expected, definition.expected); return { ...actual, rawReceipt: receipt };
});
save('CASE_MATRIX.json', { fixtureCommit: '0895926bbf0f3cf1439c75f59e5505330afa1a39', definitions: 78, referenceSelfcheck: { checks: 79, scope: 'Fixture machinery only; not added to candidate total' }, results: matrix, counts: Object.fromEntries(['PASS', 'FAIL', 'NOTEXECUTED'].map(status => [status, matrix.filter(row => row.status === status).length])), qualification: 'Four PASS count cases are independent frozen-input audits, not candidate API controls. Seven binding cases remain unexecuted against a unified successor because no such successor was declared.' });
save('final-controls-inputs.json', inventory(runtimeRoot));
console.log(JSON.stringify({ frozenCases: matrix.length, passed: matrix.filter(row => row.status === 'PASS').length, notExecuted: matrix.filter(row => row.status === 'NOTEXECUTED').length, nativeAvailable: availability.assets.length, guards: guards.length, cleanupInputs: Object.keys(JSON.parse(binding.stdout).files).length }));
