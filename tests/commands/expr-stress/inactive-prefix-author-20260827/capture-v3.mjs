import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [mode, destination] = process.argv.slice(2);
assert(['--baseline', '--candidate'].includes(mode) && /^[a-z0-9-]+$/.test(destination ?? ''),
  'Usage: node capture.mjs --baseline|--candidate UNIQUE-OUTPUT-NAME');
const receipt = JSON.parse(readFileSync(join(owned, 'freeze/receipt.json')));
const refinement = JSON.parse(readFileSync(join(owned, 'freeze/refinement-03.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function verifyFreeze() {
  for (const [file, hash] of Object.entries(refinement.files)) assert.equal(sha256(readFileSync(join(owned, file))), hash, file);
  for (const [file, hash] of Object.entries(receipt.files)) assert.equal(sha256(readFileSync(join(owned, 'freeze', file))), hash, file);
  for (const [file, hash] of Object.entries(receipt.authorDriverHashes)) assert.equal(sha256(readFileSync(join(owned, file))), hash, file);
}
function inventory(directory) {
  const result = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!prefix && ['dist', 'node_modules'].includes(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), `unexpected source symlink: ${relative}`);
      if (entry.isDirectory()) walk(join(current, entry.name), relative);
      else result[relative] = sha256(readFileSync(join(current, entry.name)));
    }
  }
  walk(directory);
  return result;
}
const output = join(owned, destination);
assert(!existsSync(output), 'capture never overwrites evidence');
mkdirSync(output);
const save = (name, data) => writeFileSync(join(output, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
function command(binary, args, cwd, timeout = 90000) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}
let scratch;
try {
  verifyFreeze();
  const independentBefore = inventory(join(root, 'tests/commands/expr-stress/sequencing-design-20260827'));
  save('independent-before.json', independentBefore);
  mkdirSync(join(owned, '.scratch'), { recursive: true });
  scratch = mkdtempSync(join(owned, '.scratch/source-'));
  const extract = command('tar', ['-xzf', join(owned, 'freeze/accepted-source.tar.gz'), '-C', scratch], root);
  assert.equal(extract.status, 0, extract.stderr);
  const archiveInventory = inventory(scratch);
  save('archive-source.json', archiveInventory);
  const baseline = readFileSync(join(owned, 'freeze/evaluate.before.ts.data'), 'utf8');
  assert.equal(readFileSync(join(scratch, receipt.evaluator), 'utf8'), baseline);
  const evaluator = mode === '--baseline' ? baseline : readFileSync(join(root, receipt.evaluator), 'utf8');
  if (mode === '--candidate') {
    assert.equal(evaluator, baseline.replace('  if (node.kind === "call") {\n', '  if (node.kind === "call") {\n    if (!active) return zero;\n'),
      'candidate is exactly the owned single-line inactive-call guard, not an arbitrary live overlay');
    writeFileSync(join(scratch, receipt.evaluator), evaluator);
    writeFileSync(join(output, 'evaluate.executed.ts.data'), evaluator, { flag: 'wx' });
  }
  const test = readFileSync(join(owned, 'freeze/inactive-prefix.test.revision-03.ts.data'));
  assert.deepEqual(readFileSync(join(root, receipt.test)), test, 'canonical author test equals frozen baseline test');
  writeFileSync(join(scratch, receipt.test), test, { flag: 'wx' });
  const sourceBefore = inventory(scratch);
  save('source-before.json', sourceBefore);
  const changed = Object.keys(sourceBefore).filter(file => sourceBefore[file] !== archiveInventory[file]).sort();
  assert.deepEqual(changed, (mode === '--baseline' ? [receipt.test] : [receipt.evaluator, receipt.test]).sort());
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  const tooling = ['typescript', 'tsx', '@types/node'].map(name => {
    const file = join(root, 'node_modules', name, 'package.json');
    return { name, version: JSON.parse(readFileSync(file)).version, packageJsonSha256: sha256(readFileSync(file)) };
  });
  save('binding.json', { mode, accepted: receipt.accepted, independent: receipt.independent, capturedAt: new Date().toISOString(),
    archiveSha256: receipt.files['accepted-source.tar.gz'], evaluatorSha256: sha256(evaluator), testSha256: sha256(test),
    overlays: changed.map(path => ({ path, before: archiveInventory[path] ?? null, after: sourceBefore[path] })),
    liveHeadAtCapture: command('git', ['rev-parse', 'HEAD'], root).stdout.trim(),
    node: process.version, platform: process.platform, arch: process.arch, tooling,
    sourceIdentity: 'Accepted committed archive + precisely listed owned overlays, NOT whole live HEAD. Tool packages are existing local tooling, not independently rebuilt or fully hash-pinned.',
    nativeOracle: 'Not invoked; unchanged independent frozen expectations/results are retained. Product-specific controls assert user requirements, not GNU parity.',
  });
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  const compilerOptions = ['--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax',
    '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node'];
  const build = command(process.execPath, [compiler, ...compilerOptions, '--rootDir', 'src', '--outDir', 'dist', '--declaration',
    'src/commands/expr/index.ts', 'src/shell/shell.ts', 'src/fs/memory/index.ts', 'src/commands/regex-execution/worker.ts'], scratch);
  save('scoped-build.json', build);
  assert.equal(build.status, 0, build.stdout || build.stderr);
  const typecheck = command(process.execPath, [compiler, ...compilerOptions, '--noEmit', receipt.test], scratch);
  save('scoped-typecheck.json', typecheck);
  const tests = command(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', receipt.test,
    'tests/commands/expr/contracts.test.ts', 'tests/commands/expr/abort-reason-regression.test.ts',
    'tests/commands/expr/regex-lifecycle.test.ts'], scratch);
  save('regressions.json', tests);
  assert.equal(tests.error, null, 'test child infrastructure failure');
  assert.equal(tests.signal, null, 'test child signal failure');
  const execution = command(process.execPath, ['--unhandled-rejections=strict', join(owned, 'freeze/independent-driver.mjs'), scratch,
    join(owned, 'freeze/cases.json')], scratch);
  save('sequencing-execution.json', execution);
  assert.equal(execution.status, 0, execution.stderr);
  const product = JSON.parse(execution.stdout);
  save('sequencing-product.json', product);
  const sourceAfter = inventory(scratch);
  assert.deepEqual(sourceAfter, sourceBefore, 'append-aware source/tests integrity, excluding generated dist and tooling symlink');
  assert.deepEqual(inventory(join(root, 'tests/commands/expr-stress/sequencing-design-20260827')), independentBefore,
    'all independent evidence unchanged, with new-entry detection');
  verifyFreeze();
  save('summary.json', {
    mode, typecheckStatus: typecheck.status, regressionStatus: tests.status,
    regressionCounts: tests.stdout.split('\n').filter(line => /^# (tests|pass|fail|cancelled|skipped|todo) /.test(line)),
    product: { pass: product.cases.filter(specimen => specimen.passed).length, total: product.cases.length,
      failed: product.cases.filter(specimen => !specimen.passed).map(specimen => ({ id: specimen.id, failures: specimen.failures })) },
    inactiveControls: product.cases.filter(specimen => ['skip-no-prefix-locale-evaluation', 'skip-no-substr-number-evaluation'].includes(specimen.id)),
    shell: { pass: product.shell.filter(specimen => specimen.passed).length, total: product.shell.length },
    oldCapPassed: product.oldCap.passed, activeWorkers: product.activeWorkers,
    integrity: { frozenInputs: true, independentEvidence: true, appendAwareSourceTests: true, compiledDistAppendProof: false },
  });
  assert.equal(typecheck.status, 0, typecheck.stdout || typecheck.stderr);
  if (mode === '--candidate') assert.equal(tests.status, 0, 'candidate regressions must pass');
  console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
} catch (error) {
  save('failure.json', { message: error.message, stack: error.stack });
  throw error;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratchRemoved: scratch ? !existsSync(scratch) : null,
    children: 'Bounded synchronous build/typecheck/test/driver children waited. Frozen driver finally terminates owned workers. Child timeout/error is an infrastructure failure, not a pass.' });
}


