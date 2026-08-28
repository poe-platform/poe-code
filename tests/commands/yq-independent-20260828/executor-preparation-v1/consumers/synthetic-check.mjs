import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertBound, assertMoveLocations, assertPackageTree, assertPublicAdmission, assertSourceMap, canonical, copyAndMoveRegularTree, expectedPackage, preparationRoot, readHashedJson, requireFact, resolveImportPath, sha256, validateReceiptShape, verifyPreseal, verifySelected } from './guards.mjs';
import { assertWorkerExit, classifyCompilerOutcome, compilerTreeIdentity, renderFixture } from './type-worker.mjs';

verifyPreseal();
const selected = verifySelected();
const controls = JSON.parse(readFileSync(join(preparationRoot, 'NEGATIVE-CASES.json'))).cases;
const jobs = JSON.parse(readFileSync(join(preparationRoot, 'JOBS.json'))).jobs;
const started = new Date().toISOString();
const scratch = mkdtempSync(join(preparationRoot, '.synthetic-'));
const evidenceParent = join(preparationRoot, 'evidence');
mkdirSync(evidenceParent, { recursive: true });
const evidence = mkdtempSync(join(evidenceParent, 'synthetic-'));
const bytes = {
  'README.md': Buffer.from('FAKE README: never a product baseline.\n'),
  'package.json': Buffer.from('{"name":"synthetic-not-product","type":"module"}\n'),
  'dist/synthetic.js': Buffer.from('FAKE COMPILED BYTES; DO NOT IMPORT\n'),
  'dist/synthetic.d.ts': Buffer.from('FAKE DECLARATION DATA; DO NOT COMPILE\n'),
};
const expected = { files: Object.fromEntries(Object.entries(bytes).map(([path, data]) => [path, { sha256: sha256(data), bytes: data.length, mode: 420 }])), directories: { '': 493, dist: 493 } };
const observations = [];

function fakeTree(name) {
  const home = join(scratch, name);
  const workspace = join(home, 'fake-workspace');
  const root = join(workspace, 'package');
  mkdirSync(join(root, 'dist'), { recursive: true, mode: 493 });
  chmodSync(root, 493);
  chmodSync(join(root, 'dist'), 493);
  for (const [path, data] of Object.entries(bytes)) { writeFileSync(join(root, path), data, { flag: 'wx', mode: 420 }); chmodSync(join(root, path), 420); }
  return { home, workspace, root, destination: join(home, 'moved') };
}

function fakePolicy(tree) {
  return { root: tree.destination, workspace: tree.workspace, entries: { synthetic: pathToFileURL(join(tree.destination, 'dist/synthetic.js')).href }, files: expected.files, allowedBuiltins: [], hookParent: pathToFileURL(join(tree.home, 'fake-hook.mjs')).href };
}

function fakeCompile(tree, outcome = 'reject') {
  const fixture = join(tree.home, 'synthetic-consumer.mts');
  const declaration = join(tree.destination, 'dist/synthetic.d.ts');
  const job = { name: 'synthetic', outcome, diagnostic: { code: 2554, line: 2 } };
  const stdout = `${outcome === 'reject' ? `${fixture}(2,19): error TS2554: Expected 0 arguments, but got 1.\n` : ''}${declaration}\n${fixture}\n`;
  return { job, result: { status: outcome === 'reject' ? 2 : 0, signal: null, error: null, stdout, stderr: '' }, files: { cwd: tree.home, fixture, candidate: tree.destination, candidateFiles: expected.files, tools: [], requiredDeclarations: [declaration] } };
}

function compileControl(tree, mutate, outcome) {
  const input = fakeCompile(tree, outcome);
  mutate(input);
  return classifyCompilerOutcome(input.job, input.result, input.files);
}

const operations = {
  'valid-tree'(tree) {
    assertPackageTree(tree.root, expected);
    const movement = copyAndMoveRegularTree(tree.root, tree.destination, expected, tree.workspace);
    assert.equal(existsSync(movement.staging), false);
    assert.notEqual(movement.root, tree.root);
    const policy = fakePolicy(tree);
    assert.equal(resolveImportPath(policy.entries.synthetic, policy.hookParent, policy), policy.entries.synthetic);
    assert.equal(resolveImportPath('./synthetic.js', policy.entries.synthetic, policy), policy.entries.synthetic);
    assert.equal(renderFixture('import "@@YQ@@";\n', { YQ: './synthetic.js' }), 'import "./synthetic.js";\n');
    for (const job of jobs) {
      const text = readFileSync(join(preparationRoot, job.fixture), 'utf8');
      assert(!renderFixture(text, { YQ: './fake-yq.js', CONTRACTS: './fake-contracts.js', ROOT: './fake-root.js' }).includes('@@'));
    }
    const identity = expected.files['dist/synthetic.js'];
    const baseline = { 'README.md': expected.files['README.md'], 'dist/contracts/index.js': identity, 'dist/contracts/index.d.ts': identity };
    const receipt = {
      schema: 1, sourceBase: selected.sourceBase, acceptedLength: selected.acceptedLength, candidateCommit: 'a'.repeat(40),
      sourceAdditions: { 'src/commands/yq/synthetic.ts': identity, 'src/commands/yq/README.md': identity },
      packageAdditions: Object.fromEntries(['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => ['dist/commands/yq/synthetic' + extension, identity])),
      packageDirectories: { '': 493, dist: 493, 'dist/contracts': 493, 'dist/commands': 493, 'dist/commands/yq': 493 },
      entries: { yq: 'dist/commands/yq/synthetic.js', contracts: 'dist/contracts/index.js' }, allowedBuiltins: [], buildReceipt: { path: join(tree.home, 'not-created-build-receipt.json'), sha256: 'b'.repeat(64) },
    };
    validateReceiptShape(receipt);
    const sourceOnly = Object.fromEntries(['schema', 'sourceBase', 'acceptedLength', 'candidateCommit', 'sourceAdditions'].map(key => [key, receipt[key]]));
    validateReceiptShape(sourceOnly, true);
    const composed = expectedPackage(receipt, baseline, expected.files['README.md']);
    assert.equal(Object.keys(composed.files).length, Object.keys(baseline).length + 4);
    assert.deepEqual(composed.files['README.md'], baseline['README.md']);
    const composedRoot = join(tree.home, 'composed-fake-package');
    for (const path of Object.keys(composed.directories)) { mkdirSync(join(composedRoot, path), { recursive: true, mode: 493 }); chmodSync(join(composedRoot, path), 493); }
    for (const path of Object.keys(composed.files)) { writeFileSync(join(composedRoot, path), path === 'README.md' ? bytes['README.md'] : bytes['dist/synthetic.js'], { flag: 'wx', mode: 420 }); chmodSync(join(composedRoot, path), 420); }
    assertPackageTree(composedRoot, composed);
  },
  'readme-absent'(tree) { rmSync(join(tree.root, 'README.md')); assertPackageTree(tree.root, expected); },
  'readme-wrong-bytes'(tree) { writeFileSync(join(tree.root, 'README.md'), 'FAKE wrong README\n'); assertPackageTree(tree.root, expected); },
  'baseline-omitted'(tree) { rmSync(join(tree.root, 'dist/synthetic.js')); assertPackageTree(tree.root, expected); },
  'unapproved-addition'(tree) { writeFileSync(join(tree.root, 'extra.data'), 'FAKE'); assertPackageTree(tree.root, expected); },
  'symlink-entry'(tree) { rmSync(join(tree.root, 'dist/synthetic.js')); symlinkSync('../README.md', join(tree.root, 'dist/synthetic.js')); assertPackageTree(tree.root, expected); },
  'hardlink-entry'(tree) { linkSync(join(tree.root, 'README.md'), join(tree.home, 'fake-link')); assertPackageTree(tree.root, expected); },
  'mode-mismatch'(tree) { chmodSync(join(tree.root, 'README.md'), 384); assertPackageTree(tree.root, expected); },
  'binding-mismatch'(tree) { assertBound(Object.freeze({ root: tree.destination })); },
  'hash-mismatch'(tree) { const path = join(tree.home, 'receipt.json'); writeFileSync(path, '{}\n'); readHashedJson(path, '0'.repeat(64)); },
  'workspace-fallback'(tree) {
    const policy = fakePolicy(tree);
    policy.entries.synthetic = pathToFileURL(join(tree.root, 'dist/synthetic.js')).href;
    resolveImportPath(policy.entries.synthetic, policy.hookParent, policy);
  },
  'in-place-not-moved'(tree) { assertMoveLocations(tree.root, join(tree.home, 'stage'), tree.root, tree.workspace); },
  'source-import'(tree) {
    const policy = fakePolicy(tree);
    const source = pathToFileURL(join(tree.destination, 'dist/synthetic.ts')).href;
    policy.entries.synthetic = source;
    resolveImportPath(source, policy.hookParent, policy);
  },
  'declaration-tampered'(tree) { writeFileSync(join(tree.root, 'dist/synthetic.d.ts'), 'FAKE any\n'); assertPackageTree(tree.root, expected); },
  'declaration-omitted'(tree) { rmSync(join(tree.root, 'dist/synthetic.d.ts')); assertPackageTree(tree.root, expected); },
  'new-empty-directory'(tree) { mkdirSync(join(tree.root, 'unexpected')); assertPackageTree(tree.root, expected); },
  'symlink-root'(tree) { const path = join(tree.home, 'fake-alias'); symlinkSync(tree.root, path); assertPackageTree(path, expected); },
  'node-modules-fallback'(tree) { const policy = fakePolicy(tree); resolveImportPath('synthetic-private-package', policy.entries.synthetic, policy); },
  'unapproved-builtin'(tree) { const policy = fakePolicy(tree); resolveImportPath('node:fs', policy.entries.synthetic, policy); },
  'unknown-receipt-field'() { validateReceiptShape({ schema: 1, surprise: true }); },
  'duplicate-receipt-key'(tree) { const path = join(tree.home, 'receipt.json'); const data = '{"schema":1,"schema":1}\n'; writeFileSync(path, data); readHashedJson(path, sha256(data)); },
  'source-delta'() { assertSourceMap({ 'src/synthetic.ts': { sha256: 'fake changed' } }, { 'src/synthetic.ts': { sha256: 'fake baseline' } }); },
  'fake-readme-authority'() { expectedPackage({}, expected.files, { sha256: '0'.repeat(64), bytes: 1, mode: 420 }); },
  'projection-only'() { const projection = { ...expected.files }; delete projection['README.md']; expectedPackage({}, projection, expected.files['README.md']); },
  'positive-compiler-outcome'(tree) { assert.equal(compileControl(tree, () => {}, 'accept').classification, 'ACCEPTED_COMPILE'); },
  'negative-compiler-outcome'(tree) {
    assert.equal(compileControl(tree, () => {}).classification, 'ACCEPTED_COMPILE_REJECTION');
    assertWorkerExit({ status: 0, signal: null, error: null });
    assert.throws(() => assertWorkerExit({ status: 1, signal: null, error: null, expectedNegative: true }), { code: 'WORKER_EXIT' });
    assert.throws(() => assertWorkerExit({ status: 2, signal: null, error: null, expectedNegative: true }), { code: 'WORKER_EXIT' });
  },
  'negative-unrelated-diagnostic'(tree) { compileControl(tree, input => { input.result.stdout = input.result.stdout.replace('TS2554', 'TS2307'); }); },
  'negative-status-zero'(tree) { compileControl(tree, input => { input.result.status = 0; }); },
  'compiler-child-signal'(tree) { compileControl(tree, input => { input.result.status = null; input.result.signal = 'SIGTERM'; }); },
  'compiler-outside-binding'(tree) { compileControl(tree, input => { input.result.stdout += join(tree.home, 'foreign.d.ts') + '\n'; }); },
  'raw-source-fallback'(tree) { compileControl(tree, input => { input.result.stdout += join(tree.destination, 'dist/synthetic.ts') + '\n'; }); },
  'public-export-gap'() { assertPublicAdmission(); },
  'mutable-binding'(tree) { assertBound({ root: tree.destination, original: tree.root, staging: join(tree.home, 'stage') }); },
  'post-check-added-file'(tree) {
    const moved = copyAndMoveRegularTree(tree.root, tree.destination, expected, tree.workspace);
    assertPackageTree(moved.root, expected);
    writeFileSync(join(moved.root, 'late.data'), 'FAKE');
    assertPackageTree(moved.root, expected);
  },
  'import-parent-outside'(tree) { const policy = fakePolicy(tree); resolveImportPath('./synthetic.js', pathToFileURL(join(tree.home, 'foreign.js')).href, policy); },
  'import-url-fragment'(tree) { const policy = fakePolicy(tree); resolveImportPath(policy.entries.synthetic + '#escape', policy.hookParent, policy); },
};

let failure;
try {
  assert.deepEqual(Object.keys(operations).sort(), controls.map(control => control.id).sort());
  for (const control of controls) {
    const tree = fakeTree(control.id);
    let caught;
    try { operations[control.id](tree); } catch (error) { caught = error; }
    const matched = control.outcome === 'accept' ? caught === undefined : caught?.code === control.outcome;
    observations.push({ id: control.id, expected: control.outcome, actual: caught?.code ?? (caught ? 'UNEXPECTED_ERROR' : 'accept'), matched, message: caught?.message ?? null, proofRole: 'SYNTHETIC_GUARD_ONLY' });
    requireFact(matched, 'SYNTHETIC_MISMATCH', control.id);
  }
  const localTools = {};
  for (const name of ['typescript', 'nodeTypes', 'undiciTypes']) {
    const pin = selected.tools[name];
    localTools[name] = compilerTreeIdentity(resolve(preparationRoot, '../../../../..', pin.path));
    assert.equal(localTools[name].sha256, pin.sha256);
    assert.equal(localTools[name].entries, pin.entries);
  }
  const coverage = JSON.parse(readFileSync(join(preparationRoot, 'COVERAGE.json')));
  assert.deepEqual(coverage.cases.map(row => row.id), ['MOV-01', 'MOV-02', 'MOV-03', 'TYP-01', 'TYP-02', 'TYP-03', 'TYP-04', 'TYP-05', 'TYP-06', 'TYP-07', 'TYP-08']);
  verifyPreseal();
  verifySelected();
} catch (error) {
  failure = error;
} finally {
  rmSync(scratch, { recursive: true });
  const hashes = Object.fromEntries(['guards.mjs', 'type-worker.mjs', 'synthetic-check.mjs', 'PRESEAL.json', 'PRETEST-CLARIFICATIONS.md'].map(path => [path, sha256(readFileSync(join(preparationRoot, path)))]));
  const result = { schema: 1, started, finished: new Date().toISOString(), presealCommit: '21ad8c589d7f138064616e8f37e748e6a2e7c200', declaredChecks: controls.length, completedChecks: observations.length, matchedChecks: observations.filter(row => row.matched).length, observations, hashes, selectedManifestSha256: sha256(readFileSync(join(preparationRoot, 'SELECTED.json'))), scope: 'Fake regular files, copied/moved only within this owned subtree with a synthetic workspace boundary; not actual relocated product evidence.', productExecutions: 0, productImports: 0, builds: 0, typeCompiles: 0, packReplays: 0, nativeOracles: 0, semanticResults: [], actualCandidate: 'PENDING', publicAdmission: 'PUBLIC_EXPORT_GAP', failure: failure ? { code: failure.code ?? null, message: failure.message } : null };
  writeFileSync(join(evidence, 'RESULTS.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 420 });
  console.log(JSON.stringify({ evidence, declared: controls.length, matched: result.matchedChecks, productExecutions: 0, failure: result.failure }));
}
if (failure) process.exitCode = 1;
