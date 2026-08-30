import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { base, candidate, capture, environment, evidence, frozen, git, inventory, load, node, productRevision, save, scratch, sha } from './review.mjs';

Object.assign(process.env, environment);
const definitions = JSON.parse(readFileSync(join(frozen, 'cases.json'))).cases;
const boundary = JSON.parse(readFileSync(join(frozen, 'boundary.json')));
const frozenTools = await import(pathToFileURL(join(frozen, 'fixture-tools.mjs')).href);
const work = join(scratch, 'runtime-controls'); mkdirSync(work);
const matrix = [];
const check = callback => { try { return { accepted: true, result: callback() }; } catch (error) { return { accepted: false, rejection: String(error.stack) }; } };
async function record(id, target, callback, method = 'actual-candidate-api') {
  const definition = definitions.find(row => row.id === id); let result;
  try { const observation = await callback(); result = { ...definition, target, method, observed: observation.accepted ? 'accept' : 'reject', status: observation.accepted === (definition.expected === 'accept') ? 'PASS' : 'FAIL', observation }; }
  catch (error) { result = { ...definition, target, method, status: 'NOTEXECUTED', limitation: 'Adapter/setup failure, not candidate rejection', error: String(error.stack) }; }
  save(id + '.json', result); matrix.push(result); console.log(id, result.status);
}
const changes = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '7d1cebf615d805f7f0077c0f9150fbe87462c1b1']).toString().trim().split('\n');
assert.deepEqual(changes.filter(path => path.endsWith('.test.ts')).sort(), boundary.migrations.map(row => row.path).sort());
assert.deepEqual(changes.filter(path => !path.endsWith('.test.ts')), [base + 'registry-73-migration/run.mjs']);
const deltas = boundary.migrations.map(entry => {
  const before = git(['show', `${boundary.observationRevision}:${entry.path}`]).toString(), after = readFileSync(join(candidate, entry.path), 'utf8');
  assert.equal(after, before.replaceAll('70', '73'));
  return { path: entry.path, beforeSha256: sha(before), afterSha256: sha(after), lines: before.split('\n').flatMap((line, index) => line === after.split('\n')[index] ? [] : [{ line: index + 1, before: line, after: after.split('\n')[index] }]) };
});
save('count-audit-corrected.json', { allChangedPaths: changes, deltas, correction: 'Initial review assertion incorrectly treated the newly added migration driver as a fixture; only the two canonical test files changed. Initial failure retained, expectations unchanged.' });
for (const definition of definitions.filter(row => row.group === 'counts')) await record(definition.id, 'frozen0895926b#migrations and exact candidate fixtures', () => {
  const value = boundary.migrations.map(({ path, from, to, assertionLines }) => ({ path, from, to, assertionLines }));
  if (definition.id === 'counts-one-migration') value.pop();
  if (definition.id === 'counts-historical-rewrite') value.push({ path: 'tests/plugins/stream-five-public/current-profile.mjs', from: 70, to: 73 });
  if (definition.id === 'counts-wrong-value') value[0].to = 74;
  return { ...check(() => frozenTools.migrations(value)), value, actualCandidateRuns: 'count-migration-driver original/revised/wrong-count-control; these synthetic migration negatives are independent audits, not an exposed candidate migration API' };
}, 'independent-frozen-input-audit');
for (const definition of definitions.filter(row => row.group === 'binding')) {
  const result = { ...definition, target: 'candidate-template.json#candidateParameters', method: 'not-substituted', status: 'NOTEXECUTED', limitation: 'No single full successor gate/source/package/native/classification/244 binding declared. Infrastructure522 and productc355 are deliberately distinct. Original synthetic selfcheck proves structure only; unified candidate binding cannot be invented.' }; save(definition.id + '.json', result); matrix.push(result);
}
const smokeReceipt = JSON.parse(readFileSync(join(evidence, 'consumer-smoke-driver.stdout')));
const smoke = JSON.parse(readFileSync(join(smokeReceipt.output, 'profile-public.stdout')));
const smokeSource = readFileSync(join(candidate, base, 'candidate-profile-73/public.mjs'), 'utf8');
const defaultCheckSource = smokeSource.slice(smokeSource.indexOf('const expected = '), smokeSource.indexOf('for (const name of ["tac"'));
assert.ok(defaultCheckSource.includes('assert.deepEqual(names, expected)'));
const defaultCheck = new Function('assert', 'names', defaultCheckSource);
save('default-check-extraction.json', { sourceSha256: sha(smokeSource), extractedSha256: sha(defaultCheckSource), extractedSource: defaultCheckSource, actualSmokeNames: smoke.names });
assert.deepEqual(smoke.names, boundary.defaultNames);
for (const definition of definitions.filter(row => row.group === 'defaults')) await record(definition.id, base + 'candidate-profile-73/public.mjs#exact-name-assertions', () => {
  const names = [...smoke.names];
  if (definition.id === 'defaults-old70') names.splice(0, 3);
  for (const excluded of ['curl', 'safejs', 'expr', 'du']) if (definition.id === 'defaults-' + excluded) { names.pop(); names.push(excluded); names.sort(); }
  return { ...check(() => defaultCheck(assert, names)), names };
}, 'exact-candidate-assertion-extraction-on-real-smoke-output');
const source = join(work, 'source'), harness = join(work, 'harness'), consumer = join(work, 'consumer'); mkdirSync(source); mkdirSync(harness); mkdirSync(consumer);
const archive = join(work, 'source.tar'); git(['archive', '--format=tar', '--output=' + archive, productRevision, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md']);
assert.equal(capture('type-source-extract', '/usr/bin/tar', ['-xf', archive, '-C', source]).status, 0);
save('type-product-inputs.json', { revision: productRevision, archiveSha256: sha(readFileSync(archive)), tree: inventory(source) });
cpSync(join(candidate, 'node_modules'), join(source, 'node_modules'), { recursive: true });
const compiler = join(source, 'node_modules/typescript/bin/tsc');
assert.equal(capture('type-product-build', node, [compiler, '-p', 'tsconfig.build.json'], { cwd: source }).status, 0);
const npm = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
const packed = capture('type-product-pack', node, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: source }); assert.equal(packed.status, 0);
const packageFile = join(work, JSON.parse(packed.stdout)[0].filename), packageHash = sha(readFileSync(packageFile)); assert.equal(packageHash, '53ab62a59574d79607692ab2d67a22f8825bf7a68b1aa17b59392c9d7cf7bf0a');
save('type-package-identity.json', { sourceRevision: productRevision, packageFile, sha256: packageHash });
const installed = join(consumer, 'node_modules/virtual-bash'); mkdirSync(installed, { recursive: true });
assert.equal(capture('type-package-extract', '/usr/bin/tar', ['-xf', packageFile, '-C', installed, '--strip-components=1']).status, 0);
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }));
const types = await load('scripts/typecheck-consumers.mjs'); const typeBinding = types.createBuiltPackageBinding(installed);
const consumerVerifierSource = readFileSync(join(candidate, 'scripts/verify-current-consumers.mjs'), 'utf8');
const verifier = await load('scripts/verify-current-consumers.mjs');
const owner = 'tests/shell-stress/env-split-validity/';
for (const name of ['public-types.mts', 'invalid-binding.mts']) copyFileSync(join(candidate, owner, name), join(consumer, name));
const tsargs = ['--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--typeRoots', join(source, 'node_modules/@types')];
const positive = capture('exact-negative-positive', node, [compiler, ...tsargs, '--traceResolution', join(consumer, 'public-types.mts')], { cwd: consumer }); assert.equal(positive.status, 0);
types.assertBuiltConsumerResolution(positive.stdout, consumer, installed, typeBinding);
const negative = capture('exact-negative-actual', node, [compiler, ...tsargs, join(consumer, 'invalid-binding.mts')], { cwd: consumer }); assert.equal(negative.status, 2);
const group = { name: 'env-split-invalid-binding', path: owner + 'invalid-binding.mts', expected: 'tests/plugins/qualified-current-release/negative-env-split.stdout', positive: 'env-split-public-types', diagnostics: 1 };
const admissionLine = consumerVerifierSource.split('\n').find(line => line.includes('positive control must pass before negative types'));
const start = consumerVerifierSource.indexOf('      assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 2);');
const end = consumerVerifierSource.indexOf('      record.status = "pass";', start);
assert.ok(start > 0 && end > start); const negativeCheckSource = admissionLine + '\n' + consumerVerifierSource.slice(start, end);
const negativeCheck = new Function('assert', 'report', 'group', 'result', 'basename', 'readFileSync', 'join', negativeCheckSource);
save('negative-check-extraction.json', { sourceSha256: sha(consumerVerifierSource), extractedSha256: sha(negativeCheckSource), source: negativeCheckSource });
const negativeReceipt = { status: negative.status, signal: negative.signal, stdout: negative.stdout, stderr: negative.stderr };
assert.equal(negative.stdout.replace(/^.*?(invalid-binding.mts\()/gmu, '$1'), boundary.negativeControl.stdout);
for (const definition of definitions.filter(row => row.group === 'negative')) await record(definition.id, 'scripts/verify-current-consumers.mjs#exact-negative-admission', () => {
  const result = { ...negativeReceipt }; const report = { root: candidate, currentConsumers: { groups: [{ name: group.positive }] } };
  if (definition.id === 'negative-wrong-line') result.stdout = result.stdout.replace('(2,41)', '(3,41)');
  if (definition.id === 'negative-wrong-code') result.stdout = result.stdout.replace('TS2741', 'TS2322');
  if (definition.id === 'negative-missing-module') result.stdout = "invalid-binding.mts(1,1): error TS2307: Cannot find module 'virtual-bash'.\n";
  if (definition.id === 'negative-positive-control-failed') report.currentConsumers.groups[0].error = 'positive compilation failed';
  if (definition.id === 'negative-unexpected-success') result.status = 0;
  return { ...check(() => negativeCheck(assert, report, group, result, basename, readFileSync, join)), result, positive: report.currentConsumers.groups };
}, 'exact-candidate-check-on-real-compiler-receipt-and-frozen-mutations');
const permissionDirectory = join(work, 'permission-real'); mkdirSync(permissionDirectory);
const admission = verifier.probeConsumerPermission({ root: source, directory: permissionDirectory }, node); save('actual-permission-admission.json', admission); assert.ok(admission.supported);
const harnessApi = await load('tests/plugins/stream-five-public/harness.mjs');
const permissionSource = consumerVerifierSource.slice(consumerVerifierSource.indexOf('export function probeConsumerPermission'), consumerVerifierSource.indexOf('export function consumerPermissionArgs')).replace('export function', 'function');
const createProbe = new Function('assert', 'realpathSync', 'sha256', 'readFileSync', 'run', 'environment', 'join', 'mkdirSync', 'writeFileSync', 'json', permissionSource + '\nreturn probeConsumerPermission;');
for (const definition of definitions.filter(row => row.group === 'permission')) await record(definition.id, 'scripts/verify-current-consumers.mjs#probeConsumerPermission / scripts/typecheck-consumers.mjs#assertBuiltConsumerResolution', () => {
  if (definition.id === 'permission-positive-and-attributed-denial') return { accepted: admission.supported, receipt: 'actual-permission-admission.json' };
  if (['permission-missing-positive', 'permission-unknown-flag', 'permission-wrong-resource'].includes(definition.id)) {
    const directory = join(work, definition.id); mkdirSync(directory); const calls = [];
    const run = (...args) => { const actual = harnessApi.run(...args), result = { ...actual }; calls.push({ actual, supplied: result });
      if (definition.id === 'permission-missing-positive' && calls.length === 2) result.status = 1;
      if (definition.id === 'permission-unknown-flag' && calls.length === 3) result.stderr = 'bad option: --permission';
      if (definition.id === 'permission-wrong-resource' && calls.length === 3) result.stderr = 'ERR_ACCESS_DENIED FileSystemRead /wrong/file';
      return result;
    };
    const probe = createProbe(assert, realpathSync, sha, readFileSync, run, environment, join, mkdirSync, writeFileSync, (path, value) => writeFileSync(path, JSON.stringify(value, null, 2)));
    return { ...check(() => probe({ root: source, directory }, node)), calls, scope: 'Frozen attribution mutation over actual Node24 probe output; not a claim the kernel emitted the synthetic failure.' };
  }
  if (definition.id === 'permission-source-fallback' || definition.id === 'permission-live-dist-fallback') {
    const fallback = join(source, definition.id === 'permission-source-fallback' ? 'src/index.ts' : 'dist/index.d.ts');
    const trace = positive.stdout.replaceAll(join(installed, 'dist/index.d.ts'), fallback);
    assert.notEqual(trace, positive.stdout);
    return { ...check(() => types.assertBuiltConsumerResolution(trace, consumer, installed, typeBinding)), fallback, traceSha256: sha(trace) };
  }
  if (definition.id === 'permission-ambient-native') {
    const result = capture('ambient-native-denied', node, [...verifier.consumerPermissionArgs(admission, consumer), '--input-type=module', '-e', `import {execFileSync} from 'node:child_process';execFileSync(${JSON.stringify(join(scratch, 'independent-controls/recovered-rg'))},['--version']);`], { cwd: consumer });
    assert.equal(result.status, 1); assert.match(result.stderr, /ERR_ACCESS_DENIED/); assert.match(result.stderr, /ChildProcess/);
    return { accepted: false, commandReceipt: 'ambient-native-denied.json', scope: 'Actual ambient native child capability rejected under consumer permission args; authenticated native oracle execution remains separate.' };
  }
  const file = join(consumer, 'fixture.test.mjs'); writeFileSync(file, "import test from 'node:test';test('reporter placement',()=>{});\n");
  const result = capture('reporter-after-input', node, [...verifier.consumerPermissionArgs(admission, consumer), file, '--test-reporter=tap'], { cwd: consumer });
  const { account } = accounting; const counts = account(result.stdout);
  return { accepted: counts.reconciled && counts.summary.tests === 1, stdout: result.stdout, accounting: counts, commandReceipt: 'reporter-after-input.json' };
});
const runtimeProfile = await load(base + 'runtime-profile-20260827/profile.mjs');
const guard = join(harness, 'import-guard.mjs'); copyFileSync(join(candidate, base, 'combined-8670ebe8/import-guard.mjs'), guard);
const expectedSource = Object.fromEntries(['src/commands/env-split.ts', 'src/commands/execution.ts'].map(path => [path, sha(readFileSync(join(source, path)))]));
save('guarded-probe-before.json', inventory(work));
const guarded = runtimeProfile.probeGuardedRuntime({ executable: node, root: work, source, harness, guard, expectedSource, environment }); save('guarded-runtime-probe.json', guarded); assert.equal(guarded.status, 0);
save('guarded-loaded-inputs.json', inventory(join(harness, 'runtime-probe-imports')));
const accounting = await load(base + 'account.mjs');
const coverage = await load('tests/plugins/qualified-current-release/runtime-coverage.mjs');
const supervisor = await load(base + 'supervise.mjs');
const tap = status => `TAP version 13\n${status === 'fail' || status === 'cancelled' ? 'not ok' : 'ok'} 1 - independent control${status === 'skipped' ? ' # SKIP fixture' : status === 'todo' ? ' # TODO fixture' : ''}\n${status === 'cancelled' ? '  ---\n  failureType: testAborted\n  ...\n' : ''}1..1\n# tests 1\n# suites 0\n# pass ${status === 'pass' ? 1 : 0}\n# fail ${status === 'fail' ? 1 : 0}\n# cancelled ${status === 'cancelled' ? 1 : 0}\n# skipped ${status === 'skipped' ? 1 : 0}\n# todo ${status === 'todo' ? 1 : 0}\n# duration_ms 1\n`;
const runnerSource = readFileSync(join(candidate, base, 'combined-8670ebe8/run.mjs'), 'utf8');
const predicate = runnerSource.match(/report\.phases\.every\(phase => (.*?)\) && report\.public/u)?.[1]; assert.ok(predicate);
save('runtime-phase-predicate.json', { sourceSha256: sha(runnerSource), predicate, scope: 'Exact historical runner phase transport/reconciliation predicate; public70 final gate and launch entrypoint are not executed.' });
const phaseAdmission = new Function('phase', 'return ' + predicate);
for (const definition of definitions.filter(row => row.group === 'runtime')) await record(definition.id, base + 'supervise.mjs + account.mjs + qualified-current-release/runtime-coverage.mjs', async () => {
  let stdout = tap('pass'), executable = node, program;
  if (definition.id === 'runtime-missing-tap') stdout = '';
  if (definition.id === 'runtime-truncated-tap') stdout = stdout.split('# tests')[0];
  for (const [suffix, status] of [['failed', 'fail'], ['cancelled', 'cancelled'], ['skipped', 'skipped'], ['todo', 'todo']]) if (definition.id === 'runtime-' + suffix) stdout = tap(status);
  if (definition.id === 'runtime-invalid-count') stdout = stdout.replace('# tests 1', '# tests NaN');
  if (definition.id === 'runtime-wrong-count') stdout = stdout.replace('# tests 1', '# tests 2');
  program = `process.stdout.write(${JSON.stringify(stdout)});`;
  if (definition.id === 'runtime-nonzero') program += 'process.exitCode=1;';
  if (definition.id === 'runtime-timeout') program += 'setInterval(()=>{},1000);';
  if (definition.id === 'runtime-signal') program += "process.kill(process.pid,'SIGTERM');";
  if (definition.id === 'runtime-abnormal-exit') executable = join(work, 'missing-node');
  const result = await supervisor.supervise(executable, ['--input-type=module', '-e', program], { cwd: work, env: environment, stdout: join(evidence, definition.id + '.stdout'), stderr: join(evidence, definition.id + '.stderr'), timeoutMs: definition.id === 'runtime-timeout' ? 300 : 10000 });
  const output = readFileSync(join(evidence, definition.id + '.stdout'), 'utf8'), accounted = accounting.account(output);
  const groups = [{ name: 'synthetic-required-runtime', files: ['fixture.test.mts'], runtime: ['fixture.test.mjs'], nodeTests: 1 }];
  const outcome = check(() => { assert.equal(phaseAdmission({ ...result, sourceChanges: [], accounting: accounted }), true); coverage.validateRuntimeResults(groups, [{ name: groups[0].name, compile: 'pass', runtimeResults: [{ runtime: 'fixture.test.mjs', status: result.status, counts: { tests: accounted.summary.tests, ...accounted.counts } }] }]); });
  return { ...outcome, supervision: result, accounting: accounted, scope: 'Actual bounded child processes emit frozen TAP payloads; actual supervisor and candidate accounting/admission. No whole gate or test-body acceptance.' };
});
save('matrix-part2.json', matrix);
save('runtime-controls-after.json', inventory(work));
