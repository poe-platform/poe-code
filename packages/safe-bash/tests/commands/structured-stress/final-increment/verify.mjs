import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const prefix = 'tests/commands/structured-stress/final-increment/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (executable, argv, environment = process.env) => {
  const result = spawnSync(executable, argv, { shell: false, env: environment, encoding: 'utf8',
    timeout: 90000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { argv: [executable, ...argv], status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const git = argv => { const result = run('git', argv); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const sourceHashes = () => Object.fromEntries(readdirSync('src/commands/structured').filter(name => name.endsWith('.ts')).sort()
  .map(name => [name, hash(readFileSync(`src/commands/structured/${name}`))]));
const runtimeTreeHash = () => {
  const paths = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (path.endsWith('.ts')) paths.push(path);
    }
  };
  visit('src');
  return hash(paths.sort().map(path => `${path} ${hash(readFileSync(path))}\n`).join(''));
};
const marker = readFileSync('/tmp/safe-bash-jq-split-integration-report.txt', 'utf8');
const headBefore = git(['rev-parse', 'HEAD']);
const before = sourceHashes();
const runtimeBefore = runtimeTreeHash();
const reports = [];
const record = (name, result) => {
  const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gm)].map(match => [match[1], Number(match[2])]));
  const failures = result.stdout.split('\n').filter(line => /^not ok /u.test(line));
  const report = { name, argv: result.argv, status: result.status, counts, failures, stderr: result.stderr };
  reports.push(report);
  console.log(JSON.stringify({ name, status: report.status, counts, failures: failures.length }));
  return report;
};
const test = (name, paths, environment) => record(name, run(process.execPath,
  ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', ...paths], environment));
const fresh = test('fresh', [`${prefix}fresh.test.ts`]);
if (fresh.status !== 0) {
  console.error('STOP: independently frozen fresh common-flow failure; inspect fresh.test.ts before any acceptance or commit.');
  process.exit(1);
}
test('original', ['tests/commands/structured/*.test.ts', 'tests/commands/structured-stress/*.test.ts']);
test('focused', ['numeric-fixes', 'quantifier-fixes', 'numeric-safety', 'safety'].map(name => `tests/commands/structured-stress/independent-increment/${name}.test.ts`));
const safetyRepetitions = [];
for (let round = 0; round < 10; round++) {
  const result = run(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap',
    'tests/commands/structured-stress/independent-increment/numeric-safety.test.ts',
    'tests/commands/structured-stress/independent-increment/safety.test.ts']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^# tests 43$/m);
  assert.match(result.stdout, /^# pass 43$/m);
  safetyRepetitions.push({ round: round + 1, status: result.status, tests: 43, pass: 43 });
}
console.log(JSON.stringify({ name: 'strict-safety-repetitions', rounds: 10, tests: 430, pass: 430 }));
test('split', ['helper', 'command', 'interop'].map(name => `tests/commands/structured-stress/split-increment/${name}.test.ts`));
test('fresh-six-backend', [`${prefix}fresh-interop.test.ts`]);
test('original-raw', ['tests/commands/structured-stress/independent-increment/native-regressions.test.ts']);
test('additive-raw', ['tests/commands/structured-stress/independent-increment/additive-regressions.test.ts']);
test('matrix-working-tree', ['tests/integration/adapter-tools/matrix.test.ts']);
test('matrix-6a259ff', ['tests/integration/adapter-tools/matrix.test.ts'], {
  ...process.env, NODE_OPTIONS: `--import=${fileURLToPath(new URL('./pinned-matrix.mjs', import.meta.url))}`,
});
const typePaths = ['src/commands/structured', 'tests/commands/structured', 'tests/commands/structured-stress',
  'tests/commands/structured-stress/independent-increment', 'tests/commands/structured-stress/split-increment', prefix.slice(0, -1)]
  .flatMap(directory => readdirSync(directory).filter(name => name.endsWith('.ts')).map(name => `${directory}/${name}`));
const types = record('scoped-types', run('node_modules/.bin/tsc', ['--noEmit', '--target', 'ES2023', '--lib', 'ES2023',
  '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes',
  '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node', ...typePaths]));
if (types.status !== 0) console.error('Scoped typecheck failed; rerun its exact argv for diagnostics.');
const native = run(process.execPath, [`${prefix}native.mjs`, '--replay']);
assert.equal(native.status, 0, native.stderr);
const freshNative = run(process.execPath, [`${prefix}native.mjs`, '--verify-fresh']);
assert.equal(freshNative.status, 0, freshNative.stderr);
const legacy = run(process.execPath, ['--import', 'tsx', 'tests/commands/structured-stress/verify-native.ts']);
assert.equal(legacy.status, 0, legacy.stderr);
const raw = run(process.execPath, ['--import', 'tsx', 'tests/commands/structured-stress/independent-increment/phase2-report.ts']);
assert.equal(raw.status, 0, raw.stderr);
const comparison = JSON.parse(raw.stdout);
const splitResult = run(process.execPath, ['--import', 'tsx', `${prefix}split-report.ts`]);
assert.equal(splitResult.status, 0, splitResult.stderr);
const splitComparison = JSON.parse(splitResult.stdout);
const after = sourceHashes();
assert.deepEqual(after, before, 'structured source changed during checks; repeat after owner checkpoint');
assert.equal(runtimeTreeHash(), runtimeBefore, 'other runtime source changed during checks; repeat the checkpoint');
const implementationCommits = ['62315bc', 'e9b30e1', '79cecde', '5356891', '73ed853', '4f9ce1e'];
const commits = implementationCommits.map(revision => {
  const paths = git(['show', '--format=', '--name-only', revision]).split('\n').filter(Boolean);
  assert.ok(paths.every(path => /^(src\/commands\/structured\/|tests\/commands\/structured\/|tests\/commands\/structured-stress\/)/u.test(path)));
  return { revision: git(['rev-parse', revision]), approvedPathsOnly: true, changedPathCount: paths.length };
});
const integrity = Object.fromEntries(['native-vectors.json', 'supplement-vectors.json', 'phase1-observation.json', 'supplement-observation.json']
  .map(name => [name, hash(readFileSync(`tests/commands/structured-stress/independent-increment/${name}`))]));
const matrix = Object.fromEntries(['README.md', 'fixtures.ts', 'matrix.test.ts'].map(name => {
  const path = `tests/integration/adapter-tools/${name}`;
  const pinned = run('git', ['show', `6a259ff:${path}`]);
  assert.equal(pinned.status, 0);
  return [name, { pinned: hash(pinned.stdout), actual: hash(readFileSync(path)) }];
}));
const summarize = matrix => ({ counts: matrix.counts, categories: matrix.categories,
  stdoutStatusParity: matrix.counts.exact + matrix.counts['diagnostic-only'],
  mismatchFields: Object.fromEntries(['status', 'stdoutHex', 'stderrHex'].map(field => [field, matrix.rows.filter(row => row.differingFields.includes(field)).length])),
  mismatches: matrix.rows.filter(row => row.classification !== 'exact').map(({ id, classification, differingFields }) => ({ id, classification, differingFields })),
});
const report = { schema: 1, independent: true, createdAt: new Date().toISOString(), headBefore, headAfter: git(['rev-parse', 'HEAD']),
  node: process.version, marker, sourceHashes: after, commits, integrity, matrix,
  reports: reports.map(({ failures, ...result }) => ({ ...result, failureCount: failures.length,
    ...(result.name.startsWith('matrix') ? { failures } : {}) })),
  runtimeTreeSha256: runtimeBefore,
  workingTreeSourceStatus: git(['status', '--porcelain', '--', 'src', 'tests/integration/adapter-tools']).split('\n').filter(Boolean),
  safetyRepetitions,
  nativeReplay: JSON.parse(native.stdout), freshReplay: JSON.parse(freshNative.stdout), olderNativeReplay: legacy.stdout.trim(),
  original: summarize(comparison.original), additive: summarize(comparison.additive),
  splitComparison: { ...splitComparison, rows: splitComparison.rows.filter(row => row.classification !== 'exact')
    .map(({ id, classification, differences }) => ({ id, classification, differences })) },
  mismatchCategories: Object.fromEntries(Object.entries(comparison.bugCategories)
    .filter(([, group]) => group.after.semantic + group.after['diagnostic-only'] > 0)),
  malformedOriginal: comparison.diagnosedOriginalMalformed,
  limitations: ['Working tree includes other owners uncommitted FS/shell work; not a clean release gate.',
    'Native oracle is jq-1.7.1-apple only; no broad jq/Bash parity or superiority claim.',
    'Strict UTF-8, stop-first-error and diagnostic differences remain, without excluding any raw matrix cases.',
    'Matrix README/test differ from 6a259ff; separate pinned replay uses exact git blobs via test-only loader, not modified expectations.',
    'Local six-backend matrix does not establish real remote-provider interoperability.'] };
const content = `${JSON.stringify(report, null, 2)}\n`;
const destination = `${prefix}verification.json`;
if (process.argv[2] === '--record') {
  assert.equal(existsSync(destination), false, 'do not overwrite the recorded verification checkpoint');
  const patch = `*** Begin Patch\n*** Add File: ${destination}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const applied = run('apply_patch', [patch]);
  assert.equal(applied.status, 0, applied.stderr);
}
console.log(JSON.stringify({ artifact: process.argv[2] === '--record' ? destination : null, sha256: hash(content), headBefore, headAfter: report.headAfter,
  original: report.original.counts, additive: report.additive.counts }));
