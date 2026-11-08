import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, save, inventory, copyRegular, git } from './artifacts.mjs';
import { parseArguments, assertInventory } from './admission.mjs';
import { supervise, classify } from './protocol.mjs';
import { cases, frozenRoot, commandScript } from './plan.mjs';
import { checkpoints, validateAdapters } from './procedures.mjs';
import { reconcileTypeRun } from './types.mjs';
import { verifyInputs } from './verify-inputs.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = resolve(directory, '../../../..');
const output = process.argv[2];
assert.ok(output && output.startsWith(join(frozenRoot, 'preparation-evidence-v1/')), 'new owned evidence path required');
const sourceBefore = inventory(directory);
const sourceRevision = process.argv[3] ?? null;
if (sourceRevision !== null) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u);
  for (const [name, expected] of Object.entries(sourceBefore)) assert.equal(hash(git(repository, ['show', `${sourceRevision}:tests/shell/dotglob-independent-20260828/execution-prep-v1/${name}`])), expected.sha256, `committed preparation source ${name}`);
}
const inputs = verifyInputs(repository);
const work = realpathSync(mkdtempSync(join(frozenRoot, '.synthetic-only-')));
const node = { path: realpathSync(process.execPath), version: process.version, sha256: hash(readFileSync(process.execPath)) };
const env = { PATH: dirname(node.path), LC_ALL: 'C', TZ: 'UTC' };
const results = [];
async function check(id, body) {
  try { const detail = await body(); results.push({ id, pass: true, detail }); }
  catch (error) { results.push({ id, pass: false, error: String(error?.stack ?? error) }); }
}
const receiptWorker = join(directory, 'synthetic-worker.mjs');
const child = (mode, args = [], options = {}) => supervise(node.path, [receiptWorker, mode, ...args], { cwd: work, env, timeoutMs: 5000, ...options });

try {
  for (const mode of ['normal', 'split-utf8', 'ordinary', 'late-exit', 'late-throw', 'duplicate', 'missing', 'summary', 'malformed', 'unretired']) await check(`receipt-${mode}`, async () => {
    const run = await child(mode), result = classify(run, ['only']);
    if (mode === 'normal' || mode === 'split-utf8') assert.equal(result.accepted, true);
    else assert.equal(result.accepted, false);
    if (mode === 'ordinary') { assert.equal(result.coherent, true); assert.deepEqual(result.failed, ['only']); }
    if (mode === 'late-exit') { assert.equal(run.code, 7); assert.equal(result.passed, 1); assert.ok(result.errors.includes('exit status contradicts body outcomes')); }
    assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
    return { run, result };
  });
  for (const mode of ['aggregate', 'falsy', 'cleanup']) await check(`settlement-${mode}`, async () => {
    const run = await child(mode), result = classify(run, ['first', 'second']);
    assert.equal(result.coherent, true); assert.deepEqual(result.failed, ['first']);
    assert.equal(result.observations[1].details.priorDisposed, true);
    assert.ok(run.stdout.includes('dispose:second'));
    return { run, result };
  });
  for (const [mode, options, failure] of [['timeout', { timeoutMs: 150 }, 'deadline'], ['overflow', { maxBytes: 1024 }, 'output-ceiling']]) await check(`bounded-${mode}`, async () => {
    const run = await child(mode, [], options);
    assert.equal(run.failure, failure); assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
    assert.equal(classify(run, ['only']).accepted, false);
    return run;
  });
  await check('synthetic-26-procedure-transport', async () => {
    const run = await child('procedures'), result = classify(run, cases().procedures.map(row => row.id));
    assert.equal(result.accepted, true);
    return { qualification: '26 synthetic checkpoint transports, NOT 26 product procedures', run, result };
  });
  await check('missing-procedure-checkpoint-rejected-after-reap', async () => {
    const run = await child('procedures', ['missing-checkpoint']), result = classify(run, cases().procedures.map(row => row.id));
    assert.equal(result.coherent, true); assert.deepEqual(result.failed, ['R01']); assert.equal(result.passed, 25);
    return { run, result };
  });
  await check('missing-or-extra-adapter-rejected', () => {
    const complete = Object.fromEntries(Object.keys(checkpoints).map(id => [id, async () => undefined]));
    validateAdapters(complete);
    delete complete.R26; assert.throws(() => validateAdapters(complete));
    complete.R26 = async () => undefined; complete.extra = async () => undefined;
    assert.throws(() => validateAdapters(complete));
  });
  await check('frozen-tuple-and-matrix-counts-quoted-not-evaluated', () => {
    const plan = cases();
    assert.equal(plan.commands.length, 102); assert.equal(plan.unsupported.length, 696); assert.equal(plan.globs.length, 72); assert.equal(plan.states.length, 14);
    assert.ok(commandScript({ initial: 'off', args: ["'quoted'"] }).includes("'\\''"));
  });
  for (const args of [[], ['--binding=x'], ['--binding=x', '--binding=x'], ['--binding=x', '--binding-sha256=y', '--binding-commit=HEAD', '--repository=/']]) await check(`held-admission-${results.length}`, async () => {
    const run = await supervise(node.path, [join(directory, 'run.mjs'), ...args], { cwd: work, env, timeoutMs: 5000 });
    assert.equal(run.code, 78); assert.equal(run.groupAbsent, true); assert.equal(run.stdout.includes('"load"'), false);
    return run;
  });
  await check('sha256-named-option-parser-not-digit-bug', () => {
    assert.equal(parseArguments(['--binding=x', '--binding-sha256=abc', '--binding-commit=def', '--repository=/'])['binding-sha256'], 'abc');
  });
  const cleanTypeRun = { stdout: '', stderr: '', code: 0, closeObserved: true, groupAbsent: true, failure: null, spawnError: null, signal: null };
  await check('type-result-specificity-controls-no-compiler-execution', () => {
    const diagnostic = 'negative-option.mts(3,75): error TS2353: synthetic exact diagnostic';
    reconcileTypeRun(cleanTypeRun, { exitCode: 0, diagnostics: [] });
    reconcileTypeRun({ ...cleanTypeRun, code: 2, stdout: diagnostic }, { exitCode: 2, diagnostics: [diagnostic] });
    assert.throws(() => reconcileTypeRun({ ...cleanTypeRun, code: 2, stdout: 'x.mts(1,1): error TS2307: Cannot find module' }, { exitCode: 2, diagnostics: [diagnostic] }));
    assert.throws(() => reconcileTypeRun({ ...cleanTypeRun, code: 2, stdout: diagnostic + '\nx.mts(1,1): error TS1234: unexpected' }, { exitCode: 2, diagnostics: [diagnostic] }));
    assert.throws(() => reconcileTypeRun(cleanTypeRun, { exitCode: 0, diagnostics: [], requiredTrace: ['bound/dist/index.d.ts'] }));
    assert.throws(() => reconcileTypeRun({ ...cleanTypeRun, code: 7 }, { exitCode: 0, diagnostics: [] }));
  });
  const loadRoot = join(work, 'load-root'), fixtureRoot = join(loadRoot, 'data');
  mkdirSync(fixtureRoot, { recursive: true });
  const preparedHarness = join(loadRoot, 'harness');
  copyRegular(directory, preparedHarness);
  const modulePath = join(fixtureRoot, 'fixture.mjs'), declaration = join(fixtureRoot, 'fixture.d.mts');
  const moduleOriginal = readFileSync(join(directory, 'fixture-value.mjs'));
  const moduleMutant = readFileSync(join(directory, 'fixture-mutant.mjs'));
  const originalDeclaration = 'export declare function probe(): number;\nexport declare function hits(): number;\n';
  writeFileSync(modulePath, moduleOriginal); writeFileSync(declaration, originalDeclaration);
  const baseManifest = {
    kind: 'dotglob-synthetic-load-v1', node,
    trees: [{ root: fixtureRoot, files: inventory(fixtureRoot) }, { root: preparedHarness, files: inventory(preparedHarness) }],
    requiredFiles: [modulePath, declaration], fixtureModule: modulePath,
  };
  async function loadRun(label, manifest, digestOverride) {
    const path = join(work, `manifest-${label}.json`);
    save(path, manifest);
    const digest = digestOverride ?? hash(readFileSync(path));
    return supervise(node.path, ['--permission', `--allow-fs-read=${loadRoot}`, `--allow-fs-read=${path}`, `--allow-fs-read=${node.path}`, join(preparedHarness, 'synthetic-worker.mjs'), 'load'], { cwd: loadRoot, env: { ...env, DOTGLOB_MANIFEST: path, DOTGLOB_MANIFEST_SHA256: digest }, timeoutMs: 5000 });
  }
  await check('actual-loaded-synthetic-original', async () => {
    const run = await loadRun('original', baseManifest);
    const result = classify(run, ['fixture-value'], { modulePath, moduleSha256: hash(moduleOriginal) });
    assert.equal(result.accepted, true); return { run, result };
  });
  for (const variant of ['wrong-manifest-digest', 'wrong-node-hash', 'wrong-node-path', 'wrong-node-version', 'missing-required-member', 'wrong-kind', 'unbound-module']) await check(`loader-${variant}`, async () => {
    const manifest = structuredClone(baseManifest);
    if (variant === 'wrong-node-hash') manifest.node.sha256 = '0'.repeat(64);
    if (variant === 'wrong-node-path') manifest.node.path += '.wrong';
    if (variant === 'wrong-node-version') manifest.node.version = 'v0.0.0';
    if (variant === 'missing-required-member') manifest.requiredFiles.push(join(fixtureRoot, 'absent.mjs'));
    if (variant === 'wrong-kind') manifest.kind = 'dotglob-product-load-v1';
    if (variant === 'unbound-module') manifest.fixtureModule = join(work, 'unbound.mjs');
    const run = await loadRun(variant, manifest, variant === 'wrong-manifest-digest' ? '0'.repeat(64) : undefined);
    assert.equal(run.code, 78); assert.equal(classify(run, ['fixture-value']).accepted, false); return run;
  });
  for (const variant of ['changed-module', 'missing-module', 'changed-declaration', 'missing-declaration', 'extra-member', 'symlink-module']) await check(`inventory-${variant}`, async () => {
    if (variant === 'changed-module') writeFileSync(modulePath, moduleMutant);
    if (variant === 'missing-module') rmSync(modulePath);
    if (variant === 'changed-declaration') writeFileSync(declaration, originalDeclaration + 'export declare const changed: true;\n');
    if (variant === 'missing-declaration') rmSync(declaration);
    if (variant === 'extra-member') writeFileSync(join(fixtureRoot, 'unexpected.json'), '{}');
    if (variant === 'symlink-module') { rmSync(modulePath); symlinkSync(join(directory, 'fixture-value.mjs'), modulePath); }
    let run;
    try { run = await loadRun(variant, baseManifest); assert.equal(run.code, 78); assert.equal(classify(run, ['fixture-value']).accepted, false); }
    finally {
      rmSync(modulePath, { force: true }); writeFileSync(modulePath, moduleOriginal);
      writeFileSync(declaration, originalDeclaration);
      rmSync(join(fixtureRoot, 'unexpected.json'), { force: true });
    }
    return run;
  });
  await check('actual-loaded-synthetic-mechanism-mutant-and-reversion', async () => {
    writeFileSync(modulePath, moduleMutant);
    const mutated = structuredClone(baseManifest); mutated.trees[0].files = inventory(fixtureRoot);
    const run = await loadRun('mechanism-mutant', mutated);
    const killed = classify(run, ['fixture-value'], { modulePath, moduleSha256: hash(moduleMutant), mutantId: 'synthetic-value-mutant', requiredFailed: ['fixture-value'] });
    assert.equal(killed.mutantKilled, true);
    writeFileSync(modulePath, moduleOriginal);
    const revertedRun = await loadRun('mechanism-reversion', baseManifest);
    const reverted = classify(revertedRun, ['fixture-value'], { modulePath, moduleSha256: hash(moduleOriginal) });
    assert.equal(reverted.accepted, true);
    return { qualification: 'actual isolated tiny-module loads, NOT product mutation evidence', run, killed, revertedRun, reverted };
  });
  await check('real-product-worker-refuses-synthetic-manifest', async () => {
    const path = join(work, 'synthetic-to-product.json'); save(path, baseManifest);
    const run = await supervise(node.path, [join(directory, 'worker.mjs'), 'commands', '0', '1'], { cwd: work, env: { ...env, DOTGLOB_MANIFEST: path, DOTGLOB_MANIFEST_SHA256: hash(readFileSync(path)) } });
    assert.equal(run.code, 78); assert.equal(run.stdout.includes('"observation"'), false);
    return run;
  });
  await check('inventory-restored-after-tamper-controls', () => assertInventory(fixtureRoot, baseManifest.trees[0].files));
} finally {
  rmSync(work, { recursive: true, force: true });
}
assert.deepEqual(inventory(directory), sourceBefore, 'preparation source unchanged while testing');
const finalInputs = verifyInputs(repository);
assert.deepEqual(finalInputs, inputs);
save(output, { qualification: 'Synthetic harness preparation only. No product/native-oracle/build/compiler execution.', node, sourceRevision, sourceBefore, inputs, results, counts: { passed: results.filter(row => row.pass).length, failed: results.filter(row => !row.pass).length }, workRemoved: work, originalInputsUnchanged: true, productExecutions: 0, nativeOracleCalls: 0, buildExecutions: 0, typeCompilations: 0 });
console.log(JSON.stringify({ output, passed: results.filter(row => row.pass).length, failed: results.filter(row => !row.pass).map(row => row.id) }));
process.exitCode = results.some(row => !row.pass) ? 1 : 0;
