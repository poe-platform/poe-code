import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [flag, captureName] = process.argv.slice(2);
assert.equal(flag, '--replay');
assert.match(captureName ?? '', /^run-[a-z0-9-]+$/u);
const output = join(owned, captureName);
assert(!existsSync(output), 'Use a new capture directory; historical runs are immutable');
mkdirSync(output);
const scratch = join(output, '.work');
const candidate = '35db31aab5be6a6d98c8ba7f006f714fa1c5da13';
const baseline = '6f2f0abb0fb337715849adf8978d5429d086fb6d';
const frozenCommit = 'd0fb3ef0bc9c3c04cae829a47454c10e565ad971';
const fixture = 'tests/commands/expr/contracts.test.ts';
const frozenRoot = 'tests/commands/expr-stress/diagnostics-review';
const started = new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function command(name, executable, args, expectedStatus = 0) {
  const before = new Date().toISOString();
  const result = spawnSync(executable, args, {
    cwd: scratch, env: { ...process.env, TSX_DISABLE_CACHE: '1' }, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  const receipt = { executable, args, cwd: scratch, started: before, finished: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  save(`${name}.json`, receipt);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, expectedStatus, name);
  return receipt;
}
function inventory(directory) {
  const entries = [];
  function visit(relative) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) { entries.push({ path, kind: 'directory' }); visit(path); }
      else { assert(entry.isFile(), path); entries.push({ path, kind: 'file', sha256: hash(readFileSync(join(directory, path))) }); }
    }
  }
  visit('');
  return entries;
}
function counts(receipt) {
  return Object.fromEntries([...receipt.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
}
function judge(input, actual) {
  const stdout = Buffer.from(actual.stdoutBase64, 'base64').toString();
  const stderr = Buffer.from(actual.stderrBase64, 'base64').toString();
  let passed = actual.activeBeforeSafetyCleanup === 0 && !actual.events.includes('workerStart');
  if (input.preabort) passed &&= actual.rejected && actual.exactReasonIdentity && stdout === '' && stderr === '';
  else if (input.expectedError) passed &&= actual.rejected && actual.error?.name === 'RangeError' && actual.error?.message === input.expectedError && stdout === '' && stderr === '';
  else if (input.id === 'literal-command-binding') passed &&= actual.status === 2 && stderr === "expr: syntax error: unexpected argument 'x'\n" && stdout === '';
  else { passed &&= actual.status === input.expectedStatus && stderr === input.expectedStderr; passed &&= input.stdoutPrefix ? stdout.startsWith(input.stdoutPrefix) : stdout === ''; }
  return { input, actual, stdout, stderr, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), passed };
}
const summarize = rows => ({ passed: rows.filter(row => row.passed).length, total: rows.length, red: rows.filter(row => !row.passed).map(row => row.input.id) });
const historicalDirectories = ['diagnostics-review', 'frozen', 'fixture-output-contract-20260827', 'qualified-final-review-20260827'];
const preservedPaths = git('ls-tree', '-r', '--name-only', candidate, '--', ...historicalDirectories.map(name => `tests/commands/expr-stress/${name}`)).toString().trim().split('\n');
const preserved = preservedPaths.map(path => {
  const expected = git('show', `${candidate}:${path}`);
  assert.equal(hash(readFileSync(join(root, path))), hash(expected), path);
  return { path, commit: candidate, gitBlob: git('rev-parse', `${candidate}:${path}`).toString().trim(), sha256: hash(expected) };
});
save('preserved-historical-inputs.json', preserved);
const historicalBefore = historicalDirectories.map(name => ({ name, entries: inventory(join(root, 'tests/commands/expr-stress', name)) }));
const historical = [
  ['qualified-final-review-20260827/expr-legacy241-candidate.json', 'historical-legacy240-of-241.json'],
  ['qualified-final-review-20260827/diagnostics-runtime12.json', 'historical-qualified-runtime11-of-12.json'],
  ['fixture-output-contract-20260827/before-01/runtime-frozen.json', 'historical-runtime11-of-12.json'],
];
for (const [path, destination] of historical) writeFileSync(join(output, destination), git('show', `${candidate}:tests/commands/expr-stress/${path}`), { flag: 'wx' });
const originalBody = git('show', `${baseline}:${fixture}`);
const approvedBody = git('show', `${candidate}:${fixture}`);
writeFileSync(join(output, 'contracts.original.ts.data'), originalBody, { flag: 'wx' });
writeFileSync(join(output, 'contracts.approved.ts.data'), approvedBody, { flag: 'wx' });
writeFileSync(join(output, 'contracts.patch'), git('diff', baseline, candidate, '--', fixture), { flag: 'wx' });
assert.equal(git('diff', '--name-only', baseline, candidate).toString().trim(), fixture);
const oldAssertion = '    assert.equal(actual.exitCode, 2); assert.match(actual.stderr, /locale|collation/u);';
const newAssertion = '    if (args[0] === "length") {\n      assert.equal(actual.exitCode, 0); assert.equal(actual.stdout, "3\\n"); assert.equal(actual.stderr, "");\n    } else {\n      assert.equal(actual.exitCode, 2); assert.match(actual.stderr, /locale|collation/u);\n    }';
assert.equal(originalBody.toString().split(oldAssertion).length, 2);
assert.equal(originalBody.toString().replace(oldAssertion, newAssertion), approvedBody.toString());
save('assertion-delta.json', { baseline, candidate, path: fixture, originalSha256: hash(originalBody), approvedSha256: hash(approvedBody),
  exactlyOneTextReplacement: true, oldAssertion, newAssertion, unchangedArgv: [['length', 'abc'], ['a', '<', 'b']], unchangedEnv: { LC_ALL: 'en_US.UTF-8' },
  scope: 'Only the length iteration expectation changes. Full original and approved bodies retained. All other bytes, including collation/unrepresentable controls, are identical.' });
const originalBinding = git('show', `${frozenCommit}:${frozenRoot}/freeze/runtime-binding.json`);
const originalDriver = git('show', `${frozenCommit}:${frozenRoot}/runtime-driver.mjs`);
assert.equal(hash(readFileSync(join(root, frozenRoot, 'freeze/runtime-binding.json'))), hash(originalBinding));
assert.equal(hash(readFileSync(join(root, frozenRoot, 'runtime-driver.mjs'))), hash(originalDriver));
writeFileSync(join(output, 'runtime-binding.original.json'), originalBinding, { flag: 'wx' });
writeFileSync(join(output, 'runtime-driver.original.mjs'), originalDriver, { flag: 'wx' });
const oldCases = JSON.parse(originalBinding).cases;
const newBinding = readFileSync(join(owned, 'runtime-binding.v2.json'));
const newCases = JSON.parse(newBinding).cases;
const authorized = JSON.parse(originalBinding);
const changedCase = authorized.cases.find(input => input.id === 'syntax-output-one');
changedCase.expectedStatus = 3;
changedCase.expectedStderr = 'expr: output bytes limit exceeded\n';
assert.deepEqual(JSON.parse(newBinding), authorized);
assert.equal(oldCases.length, 12);
const delta = oldCases.flatMap((input, index) => JSON.stringify(input) === JSON.stringify(newCases[index]) ? [] : [{ before: input, after: newCases[index] }]);
assert.equal(delta.length, 1);
assert.equal(delta[0].before.id, 'syntax-output-one');
save('runtime-expectation-delta.json', { frozenCommit, frozenPath: `${frozenRoot}/freeze/runtime-binding.json`,
  originalSha256: hash(originalBinding), version2Sha256: hash(newBinding), driverSha256: hash(originalDriver), changed: delta,
  classification: 'Version 2 changes exactly two expected tuple fields in one row. All 12 argv, limits, environment behavior and driver assertions are retained. Not a recapture or rebaseline.' });
const selected = ['src', 'tests/commands/expr', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const sourcePaths = git('ls-tree', '-r', '--name-only', baseline, '--', ...selected).toString().trim().split('\n');
const sourceBindings = sourcePaths.map(path => ({ path, gitBlob: git('rev-parse', `${baseline}:${path}`).toString().trim(), sha256: hash(git('show', `${baseline}:${path}`)) }));
save('source-test-bindings.json', { baseline, candidate, selected, files: sourceBindings });
save('provenance.json', { started, baseline, candidate, frozenCommit, selected, node: { version: process.version, executable: process.execPath, sha256: hash(readFileSync(process.execPath)) },
  host: { platform: process.platform, arch: process.arch }, headAtStart: git('rev-parse', 'HEAD').toString().trim(),
  liveStatusAtStart: git('status', '--short').toString(), indexAtStart: git('diff', '--cached', '--name-only').toString(),
  toolchain: ['typescript/package.json', 'typescript/lib/tsc.js', 'typescript/lib/_tsc.js', 'tsx/package.json', 'tsx/dist/loader.mjs', '@types/node/package.json'].map(path => ({ path, sha256: hash(readFileSync(join(root, 'node_modules', path))) })),
  qualification: 'Selected committed source/tests archive plus only the committed contract assertion delta. No native execution, recapture, full gate, distribution acceptance, or repeat promotion.' });
let sourceBefore, compiledBefore;
try {
  mkdirSync(scratch);
  const archive = git('archive', '--format=tar', baseline, ...selected);
  const extraction = spawnSync('tar', ['-xf', '-', '-C', scratch], { input: archive, timeout: 30000 });
  assert.ifError(extraction.error); assert.equal(extraction.status, 0);
  for (const entry of sourceBindings) assert.equal(hash(readFileSync(join(scratch, entry.path))), entry.sha256, entry.path);
  sourceBefore = inventory(scratch);
  save('archive-before.json', { archiveSha256: hash(archive), entries: sourceBefore });
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
  command('build', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json']);
  compiledBefore = inventory(join(scratch, 'dist'));
  save('compiled-before.json', compiledBefore);
  const originalTest = command('contracts-original', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', fixture], 1);
  assert.deepEqual(counts(originalTest), { tests: 27, pass: 26, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  writeFileSync(join(scratch, fixture), approvedBody);
  const approvedTest = command('contracts-approved', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', fixture]);
  assert.deepEqual(counts(approvedTest), { tests: 27, pass: 27, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const relevant = ['grammar', 'diagnostics-regression', 'named-profile', 'inactive-prefix'].map(name => `tests/commands/expr/${name}.test.ts`);
  const controls = command('unchanged-controls', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...relevant]);
  const controlCounts = counts(controls);
  assert.equal(controlCounts.pass, controlCounts.tests);
  assert.equal(controlCounts.skipped + controlCounts.cancelled + controlCounts.todo, 0);
  const strictConfig = { extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, include: [fixture, ...relevant], exclude: [] };
  writeFileSync(join(scratch, 'approved-strict.json'), JSON.stringify(strictConfig));
  save('strict-scope.json', strictConfig);
  command('strict-scoped', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'approved-strict.json']);
  rmSync(join(scratch, 'approved-strict.json'));
  const { run } = await import(pathToFileURL(join(output, 'runtime-driver.original.mjs')).href);
  const oldRows = [];
  for (const input of oldCases) oldRows.push(judge(input, await run({ installed: scratch, input })));
  save('runtime-original-replay.json', { constructor: 'createExprCommand({limits:payload.input.limits})', rows: oldRows, summary: summarize(oldRows) });
  assert.deepEqual(summarize(oldRows), { passed: 11, total: 12, red: ['syntax-output-one'] });
  const syntax = oldRows.find(row => row.input.id === 'syntax-output-one');
  assert.deepEqual([syntax.actual.status, syntax.stdout, syntax.stderr, syntax.stderrBytes], [3, '', 'expr: output bytes limit exceeded\n', 34]);
  const newRows = [];
  for (const input of newCases) newRows.push(judge(input, await run({ installed: scratch, input })));
  save('runtime-v2-replay.json', { constructor: 'createExprCommand({limits:payload.input.limits})', rows: newRows, summary: summarize(newRows) });
  assert.deepEqual(summarize(newRows), { passed: 12, total: 12, red: [] });
  const exactResult = row => ({ status: row.actual.status, stdoutBase64: row.actual.stdoutBase64, stderrBase64: row.actual.stderrBase64,
    rejected: row.actual.rejected, error: row.actual.error, exactReasonIdentity: row.actual.exactReasonIdentity, events: row.actual.events,
    activeAtSettlement: row.actual.activeAtSettlement, activeBeforeSafetyCleanup: row.actual.activeBeforeSafetyCleanup, activeAfterSafetyCleanup: row.actual.activeAfterSafetyCleanup });
  assert.deepEqual(oldRows.map(exactResult), newRows.map(exactResult));
  save('runtime-exact-delta-replay.json', { identicalResultTuplesAll12: true, omittedFromEquality: ['imports: cached imports differ on sequential replay'],
    acceptanceDeltaOnly: 'syntax-output-one', original: summarize(oldRows), version2: summarize(newRows),
    limitation: 'Sequential in-process replay of the unchanged driver, bounded by the outer command watchdog. Not new per-case isolation or universal lifecycle proof.' });
  const blockerInput = { id: 'ordinary-division-output-one', argv: ['1', '/', '0'], limits: { maxOutputBytes: 1 }, expectedStatus: 3, expectedStderr: 'expr: output bytes limit exceeded\n', workers: 0 };
  const blocker = judge(blockerInput, await run({ installed: scratch, input: blockerInput }));
  save('ordinary-error-policy-blocker.json', { classification: 'Separate policy-negative control; excluded from both frozen 12-case denominators. Failure is retained, not rebaselined.', ...blocker });
  assert.equal(blocker.passed, false);
  assert.deepEqual([blocker.actual.status, blocker.stdout, blocker.stderr, blocker.stderrBytes], [2, '', 'expr: division by zero\n', 23]);
  const compiledAfter = inventory(join(scratch, 'dist'));
  assert.deepEqual(compiledAfter, compiledBefore);
  save('compiled-after.json', compiledAfter);
  rmSync(join(scratch, 'node_modules'));
  rmSync(join(scratch, 'dist'), { recursive: true });
  const sourceAfter = inventory(scratch);
  const expectedAfter = sourceBefore.map(entry => entry.path === fixture ? { ...entry, sha256: hash(approvedBody) } : entry);
  assert.deepEqual(sourceAfter, expectedAfter, 'Only approved fixture changes; detect added files and directories too');
  save('archive-after.json', sourceAfter);
  for (const entry of preserved) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
  assert.deepEqual(historicalDirectories.map(name => ({ name, entries: inventory(join(root, 'tests/commands/expr-stress', name)) })), historicalBefore);
  save('integrity.json', { sourceArchiveMatchesGitBefore: true, sourceAfterOnlyApprovedFixture: true, compiledUnchanged: true,
    historicalFilesUnchanged: preserved.length, historicalDirectoryEntriesUnchanged: true, detectsNewEntries: true,
    scope: 'Selected archive and four named historical directories only, not the entire live tree.' });
  save('summary.json', { started, finished: new Date().toISOString(), baseline, candidate,
    originalContracts: counts(originalTest), approvedContracts: counts(approvedTest), unchangedControls: controlCounts,
    historicalLegacy: '240/241 raw results preserved; no new 241-case run or inferred 241/241', originalRuntime: summarize(oldRows), version2Runtime: summarize(newRows),
    ordinaryErrorPolicy: { passed: blocker.passed, status: blocker.actual.status, stderrBytes: blocker.stderrBytes, limit: 1 },
    policySatisfied: false, sourceDocsModified: false, noNativeExecution: true, fullGate: false });
} finally {
  if (existsSync(scratch)) rmSync(scratch, { recursive: true });
  save('cleanup.json', { ownedScratch: scratch, absent: !existsSync(scratch), scope: 'Only this run directory .work was removed; no shared dist, external scratch, or other workers touched.' });
}
console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
