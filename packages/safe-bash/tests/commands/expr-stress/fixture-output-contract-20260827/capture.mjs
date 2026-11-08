import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { arch, platform, release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [flag, phase, destination, fixtureCommit] = process.argv.slice(2);
assert.equal(flag, '--capture');
assert(['before', 'after'].includes(phase));
assert(destination && /^[a-z0-9-]+$/.test(destination));
assert.equal(phase === 'after', Boolean(fixtureCommit));
const base = '21220b465537bf45ffcfb36740956a69f43bf75e';
const grammar = 'tests/commands/expr/grammar.test.ts';
const review = 'tests/commands/expr-stress/diagnostics-review';
const previous = 'tests/commands/expr-stress/diagnostics-candidate-review';
const output = join(owned, destination);
assert(!existsSync(output), 'capture destination must be new');
mkdirSync(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const git = args => {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const blob = (commit, name) => git(['show', `${commit}:${name}`]);
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const absolute = join(directory, name), entry = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) return [{ path: entry, kind: 'symlink', target: readlinkSync(absolute) }];
    if (stat.isDirectory()) return [{ path: entry, kind: 'directory' }, ...inventory(absolute, entry)];
    return [{ path: entry, kind: 'file', size: stat.size, sha256: hash(readFileSync(absolute)) }];
  });
}
function command(binary, args, cwd, timeout = 240000, options = {}) {
  const result = spawnSync(binary, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, ...options });
  return { binary, args, cwd, timeout, status: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '',
    stdoutBase64: result.stdout?.toString('base64') ?? '', stderrBase64: result.stderr?.toString('base64') ?? '' };
}
const start = new Date().toISOString();
const head = git(['rev-parse', 'HEAD']).toString().trim();
const initialStatus = git(['status', '--porcelain=v1']).toString();
const initialIndex = git(['diff', '--cached', '--name-only']).toString();
const historicalNames = ['REPORT.md', 'replay/regressions/expr-legacy241.json', 'replay/regressions/expr-legacy241-qualified.json', 'replay/regressions/legacy-prerequisite-repair-before.json', 'replay/regressions/legacy-prerequisite-repair-after.json'];
const frozenNames = ['runtime-driver.mjs', 'independent.mjs', 'inputs.json', 'freeze/runtime-binding.json', 'freeze/independent-native.json', 'FREEZE.md', 'REPORT.md'];
const preserved = [];
for (const name of frozenNames) {
  const commit = name === 'REPORT.md' ? '1231700a' : 'd0fb3ef0';
  const bytes = blob(commit, `${review}/${name}`);
  assert.deepEqual(bytes, readFileSync(join(root, review, name)));
  const target = `frozen-${name.replaceAll('/', '__')}`;
  save(target, bytes);
  preserved.push({ source: `${review}/${name}`, commit: git(['rev-parse', commit]).toString().trim(), target, sha256: hash(bytes) });
}
for (const name of historicalNames) {
  const bytes = blob(head, `${previous}/${name}`);
  assert.deepEqual(bytes, readFileSync(join(root, previous, name)));
  const target = `historical-${name.replaceAll('/', '__')}`;
  save(target, bytes);
  preserved.push({ source: `${previous}/${name}`, commit: head, target, sha256: hash(bytes) });
}
save('preserved-inputs.json', preserved);
const oldGrammar = blob(base, grammar);
const newGrammar = phase === 'after' ? blob(fixtureCommit, grammar) : oldGrammar;
save('grammar.before.ts.data', oldGrammar);
save('grammar.executed.ts.data', newGrammar);
if (phase === 'after') {
  assert(/^[0-9a-f]{40}$/.test(fixtureCommit));
  const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', fixtureCommit]).toString().trim().split('\n');
  assert.deepEqual(changed, [grammar]);
  save('fixture.patch', git(['diff', base, fixtureCommit, '--', grammar]));
}
const selected = ['src', 'tests/commands/expr', 'tests/commands/expr-author/regex-audit-cases.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const tar = git(['archive', '--format=tar', base, ...selected]);
const scratch = mkdtempSync(join(owned, '.archive-'));
const nativeIdentity = JSON.parse(blob('d0fb3ef0', `${review}/freeze/independent-native.json`)).identity;
const nativeBefore = hash(readFileSync(nativeIdentity.actualPath));
assert.equal(nativeBefore, nativeIdentity.sha256);
const dependencies = realpathSync(join(root, 'node_modules'));
const depsBefore = inventory(dependencies);
save('dependencies.before.json', depsBefore);
const nodeIdentity = { version: process.version, binary: process.execPath, realpath: realpathSync(process.execPath), sha256: hash(readFileSync(process.execPath)) };
let sourceBefore, boundBefore, distBefore, runtimeSummary, summaries = {};
try {
  const unpack = spawnSync('tar', ['-xf', '-', '-C', scratch], { input: tar });
  assert.equal(unpack.status, 0, unpack.stderr?.toString());
  if (phase === 'after') {
    const overlay = git(['archive', '--format=tar', fixtureCommit, grammar]);
    const unpackFixture = spawnSync('tar', ['-xf', '-', '-C', scratch], { input: overlay });
    assert.equal(unpackFixture.status, 0, unpackFixture.stderr?.toString());
  }
  sourceBefore = inventory(scratch);
  save('archive-source.before.json', sourceBefore);
  symlinkSync(dependencies, join(scratch, 'node_modules'), 'dir');
  mkdirSync(join(scratch, 'tests/commands/metadata-stress'));
  symlinkSync(dirname(dirname(dirname(nativeIdentity.actualPath))), join(scratch, 'tests/commands/metadata-stress/.oracle'), 'dir');
  assert.equal(hash(readFileSync(join(scratch, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr'))), nativeBefore);
  boundBefore = inventory(scratch);
  const build = command(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '-p', 'tsconfig.build.json'], scratch);
  save('build.json', build);
  assert.equal(build.status, 0, build.stderr + build.stdout);
  distBefore = inventory(join(scratch, 'dist'));
  save('dist.before.json', distBefore);
  const legacyArgs = JSON.parse(blob(head, `${previous}/replay/regressions/expr-legacy241-qualified.json`)).args;
  const grammarResult = command(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', grammar], scratch);
  save('grammar-run.json', grammarResult);
  const legacyResult = command(process.execPath, legacyArgs, scratch);
  save('legacy241-run.json', legacyResult);
  for (const [label, result] of [['grammar', grammarResult], ['legacy', legacyResult]]) {
    summaries[label] = { status: result.status, lines: result.stdout.split('\n').filter(line => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo)\b|^✖ expr invalid /.test(line)) };
  }
  if (phase === 'before') {
    const { run } = await import(pathToFileURL(join(output, 'frozen-runtime-driver.mjs')).href);
    const inputs = JSON.parse(readFileSync(join(output, 'frozen-freeze__runtime-binding.json'))).cases;
    const rows = [];
    for (const input of inputs) {
      const actual = await run({ installed: scratch, input });
      const stdout = Buffer.from(actual.stdoutBase64, 'base64').toString();
      const stderr = Buffer.from(actual.stderrBase64, 'base64').toString();
      let passed = actual.activeBeforeSafetyCleanup === 0 && !actual.events.includes('workerStart');
      if (input.preabort) passed &&= actual.rejected && actual.exactReasonIdentity && stdout === '' && stderr === '';
      else if (input.expectedError) passed &&= actual.rejected && actual.error?.name === 'RangeError' && actual.error?.message === input.expectedError && stdout === '' && stderr === '';
      else if (input.id === 'literal-command-binding') passed &&= actual.status === 2 && stderr === "expr: syntax error: unexpected argument 'x'\n" && stdout === '';
      else { passed &&= actual.status === input.expectedStatus && stderr === input.expectedStderr; passed &&= input.stdoutPrefix ? stdout.startsWith(input.stdoutPrefix) : stdout === ''; }
      rows.push({ input, actual, stdout, stderr, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), passed });
    }
    runtimeSummary = { passed: rows.filter(row => row.passed).length, total: rows.length, red: rows.filter(row => !row.passed).map(row => row.input.id) };
    save('runtime-frozen.json', { constructor: 'createExprCommand({limits:payload.input.limits})', rows, summary: runtimeSummary });
    const controls = [
      { id: 'success-one', argv: ['1'], limits: { maxOutputBytes: 1 } },
      { id: 'success-two', argv: ['1'], limits: { maxOutputBytes: 2 } },
      { id: 'false-empty-one', argv: [''], limits: { maxOutputBytes: 1 } },
      { id: 'syntax-default', argv: ['1', 'x'] },
      { id: 'syntax-boundary-below', argv: ['1', 'x'], limits: { maxOutputBytes: 41 } },
      { id: 'syntax-boundary-exact', argv: ['1', 'x'], limits: { maxOutputBytes: 42 } },
      { id: 'fixed-arithmetic-error-one', argv: ['1', '/', '0'], limits: { maxOutputBytes: 1 } },
      { id: 'missing-operand-one', argv: [], limits: { maxOutputBytes: 1 } },
      { id: 'quote-expansion-string-eight', argv: ['1', 'éé'], limits: { maxStringBytes: 8 } },
    ];
    const observations = [];
    for (const input of controls) {
      const actual = await run({ installed: scratch, input });
      observations.push({ input, actual, stdout: Buffer.from(actual.stdoutBase64, 'base64').toString(), stderr: Buffer.from(actual.stderrBase64, 'base64').toString() });
    }
    save('runtime-observations.json', { classification: 'Separate exploratory observations; no changed frozen assertions or expanded acceptance denominator.', observations });
  } else {
    const diagnostics = command(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'tests/commands/expr/diagnostics-regression.test.ts'], scratch);
    save('diagnostics-run.json', diagnostics);
    summaries.diagnostics = { status: diagnostics.status, lines: diagnostics.stdout.split('\n').filter(line => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo)\b/.test(line)) };
  }
  const after = inventory(scratch);
  const withoutDist = after.filter(entry => entry.path !== 'dist' && !entry.path.startsWith('dist/'));
  assert.deepEqual(withoutDist, boundBefore, 'append-aware source/test/prerequisite inventory unchanged');
  assert.deepEqual(inventory(join(scratch, 'dist')), distBefore);
  assert.deepEqual(inventory(dependencies), depsBefore);
  assert.equal(hash(readFileSync(nativeIdentity.actualPath)), nativeBefore);
  assert.equal(hash(readFileSync(process.execPath)), nodeIdentity.sha256);
  for (const item of preserved) assert.equal(hash(readFileSync(join(root, item.source))), item.sha256);
  save('integrity.json', { sourceTestsIncludingNewEntriesUnchanged: true, compiledArtifactsIncludingNewEntriesUnchanged: true, dependenciesIncludingNewEntriesUnchanged: true, nativeExecutableUnchanged: true, preservedEvidenceUnchanged: true, nodeExecutableUnchanged: true, sourceInventorySha256: hash(JSON.stringify(sourceBefore)), boundInventorySha256: hash(JSON.stringify(boundBefore)), distInventorySha256: hash(JSON.stringify(distBefore)), dependenciesInventorySha256: hash(JSON.stringify(depsBefore)), addedBindings: boundBefore.filter(entry => !sourceBefore.some(original => original.path === entry.path)) });
  save('summary.json', { start, end: new Date().toISOString(), phase, base, fixtureCommit: fixtureCommit ?? null, headAtStart: head, sourceComposition: phase === 'after' ? 'Accepted-base selected archive plus ONLY grammar fixture from committed fixture delta; not a whole-commit archive gate.' : 'Accepted-base selected archive; not a whole-repository gate.', selectedArchivePaths: selected, archiveTarSha256: hash(tar), scratch, nodeIdentity, host: { platform: platform(), release: release(), arch: arch() }, nativeIdentity, nativeSha256Before: nativeBefore, initialStatus, initialIndex, summaries, runtimeSummary });
  console.log(JSON.stringify({ phase, summaries, runtimeSummary }));
} finally {
  assert(relative(owned, scratch).startsWith('.archive-'));
  rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratch, removed: !existsSync(scratch), onlyOwnedScratchRemoved: true, nativeExecutableStillMatches: hash(readFileSync(nativeIdentity.actualPath)) === nativeBefore, end: new Date().toISOString() });
}
