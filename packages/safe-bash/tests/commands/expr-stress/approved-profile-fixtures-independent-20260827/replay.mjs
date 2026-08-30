import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [flag, runName, requestedCommit] = process.argv.slice(2);
assert.equal(flag, '--capture');
assert.match(runName ?? '', /^run-[a-z0-9-]+$/u);
assert.match(requestedCommit ?? '', /^[a-f0-9]{40}$/u);
const output = join(owned, runName);
assert(!existsSync(output), 'never overwrite a prior attempt');
mkdirSync(output);
const work = join(output, '.work');
mkdirSync(work);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
function inventory(directory) {
  const entries = [];
  function walk(relative) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const name = join(relative, entry.name), absolute = join(directory, name);
      if (entry.isDirectory()) { entries.push({ path: name, type: 'directory' }); walk(name); }
      else if (entry.isSymbolicLink()) entries.push({ path: name, type: 'symlink', target: readlinkSync(absolute) });
      else { assert(entry.isFile()); const body = readFileSync(absolute); entries.push({ path: name, type: 'file', bytes: body.length, sha256: hash(body) }); }
    }
  }
  walk('');
  return entries;
}
function command(name, executable, args, cwd, status = 0) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: { ...process.env, TSX_DISABLE_CACHE: '1' }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const record = { executable, args, cwd, started, finished: new Date().toISOString(), pid: result.pid,
    status: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  save(`${name}.json`, record);
  assert.ifError(result.error);
  assert.equal(result.signal, null, name);
  assert.equal(result.status, status, name);
  return record;
}
const counts = result => Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
const freezeBody = readFileSync(join(owned, 'FREEZE.json'));
const freeze = JSON.parse(freezeBody);
const freezeCommit = '7f4f187b';
const ownedRelative = 'tests/commands/expr-stress/approved-profile-fixtures-independent-20260827';
const candidate = git('rev-parse', requestedCommit).toString().trim();
const baseline = git('rev-parse', `${freeze.approvedMigration}^`).toString().trim();
const selected = ['src', 'tests/commands/expr', 'tests/commands/expr-author', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const historicalPaths = [
  'tests/commands/expr-stress/qualified-final-review-20260827/expr-legacy241-candidate.json',
  'tests/commands/expr-stress/qualified-final-review-20260827/diagnostics-runtime12.json',
  'tests/commands/expr-stress/fixture-output-contract-20260827/before-01/runtime-frozen.json',
];
const sourceBefore = new Map(), compiledBefore = new Map();
const oldDirs = ['diagnostics-review', 'frozen', 'fixture-output-contract-20260827', 'qualified-final-review-20260827'];
const oldInventory = () => oldDirs.map(name => ({ name, entries: inventory(join(root, 'tests/commands/expr-stress', name)) }));
let preservedBefore;
const started = new Date().toISOString();
try {
  assert.equal(hash(freezeBody), hash(git('show', `${freezeCommit}:${ownedRelative}/FREEZE.json`)));
  git('merge-base', '--is-ancestor', freeze.approvedMigration, candidate);
  git('merge-base', '--is-ancestor', freezeCommit, candidate);
  assert.equal(git('diff', '--name-only', baseline, freeze.approvedMigration).toString().trim(), freeze.fixture);
  assert.equal(git('diff', '--name-only', freeze.approvedMigration, candidate, '--', ...selected).toString(), '', 'actual composition differs from approved selected inputs');
  const original = git('show', `${baseline}:${freeze.fixture}`).toString();
  const revised = git('show', `${candidate}:${freeze.fixture}`).toString();
  const acceptsFixture = body => original.split(freeze.beforeAssertion).length === 2 && original.replace(freeze.beforeAssertion, freeze.afterAssertion) === body;
  assert(acceptsFixture(revised));
  writeFileSync(join(output, 'contracts.original.ts.data'), original, { flag: 'wx' });
  writeFileSync(join(output, 'contracts.revised.ts.data'), revised, { flag: 'wx' });
  writeFileSync(join(output, 'approved.patch'), git('diff', baseline, candidate, '--', freeze.fixture), { flag: 'wx' });
  const bindingPath = 'tests/commands/expr-stress/diagnostics-review/freeze/runtime-binding.json';
  const driverPath = 'tests/commands/expr-stress/diagnostics-review/runtime-driver.mjs';
  const oldBindingBytes = git('show', `${freeze.runtimeReference}:${bindingPath}`);
  const oldBinding = JSON.parse(oldBindingBytes);
  const newBindingBytes = readFileSync(join(root, 'tests/commands/expr-stress/approved-profile-fixtures-20260827/runtime-binding.v2.json'));
  const newBinding = JSON.parse(newBindingBytes);
  const expectedBinding = structuredClone(oldBinding);
  const changed = expectedBinding.cases.find(input => input.id === 'syntax-output-one');
  changed.expectedStatus = 3;
  changed.expectedStderr = 'expr: output bytes limit exceeded\n';
  assert.deepEqual(newBinding, expectedBinding);
  assert.equal(oldBinding.cases.length, 12);
  const acceptsBinding = value => { try { assert.deepEqual(value, expectedBinding); return true; } catch { return false; } };
  const mutations = [];
  const reject = (name, accepted) => { assert.equal(accepted, false, name); mutations.push({ name, rejected: true }); };
  reject('changed environment', acceptsFixture(revised.replace('LC_ALL: "en_US.UTF-8"', 'LC_ALL: "C.UTF-8"')));
  reject('changed argv', acceptsFixture(revised.replace('["length", "abc"]', '["length", "abcd"]')));
  reject('weakened named collation', acceptsFixture(revised.replace('} else {\n      assert.equal(actual.exitCode, 2)', '} else {\n      assert.equal(actual.exitCode, 0)')));
  reject('removed unrepresentable control', acceptsFixture(revised.replace('"a\\0b", ', '')));
  const extraRow = structuredClone(newBinding); extraRow.cases[0].workers = 1;
  reject('second runtime-row change', acceptsBinding(extraRow));
  const extraArgv = structuredClone(newBinding); extraArgv.cases[1].argv[1] = 'y';
  reject('runtime argv change', acceptsBinding(extraArgv));
  const extraLimit = structuredClone(newBinding); extraLimit.cases[1].limits.maxOutputBytes = 2;
  reject('runtime limit change', acceptsBinding(extraLimit));
  const negativeRoot = join(work, 'inventory-negative'); mkdirSync(negativeRoot);
  writeFileSync(join(negativeRoot, 'original'), 'before');
  const expectedInventory = inventory(negativeRoot);
  const acceptsInventory = () => JSON.stringify(inventory(negativeRoot)) === JSON.stringify(expectedInventory);
  writeFileSync(join(negativeRoot, 'added'), 'new'); reject('new archived file', acceptsInventory()); rmSync(join(negativeRoot, 'added'));
  writeFileSync(join(negativeRoot, 'original'), 'after'); reject('changed archived file', acceptsInventory()); writeFileSync(join(negativeRoot, 'original'), 'before');
  mkdirSync(join(negativeRoot, 'added-directory')); reject('new archived directory', acceptsInventory());
  save('negative-controls.json', { freezeCommit: git('rev-parse', freezeCommit).toString().trim(), mutations, allRejected: true });
  save('binding-delta.json', { originalSha256: hash(oldBindingBytes), revisedSha256: hash(newBindingBytes), changedRows: ['syntax-output-one'],
    unchangedArgv: ['1', 'x'], unchangedLimits: { maxOutputBytes: 1 }, before: oldBinding.cases[1], after: newBinding.cases[1],
    beforeStderrBytes: Buffer.byteLength(oldBinding.cases[1].expectedStderr), afterStderrBytes: Buffer.byteLength(newBinding.cases[1].expectedStderr) });
  writeFileSync(join(output, 'runtime-binding.original.json'), oldBindingBytes, { flag: 'wx' });
  writeFileSync(join(output, 'runtime-binding.revised.json'), newBindingBytes, { flag: 'wx' });
  const driverBytes = git('show', `${freeze.runtimeReference}:${driverPath}`);
  writeFileSync(join(output, 'runtime-driver.original.mjs'), driverBytes, { flag: 'wx' });
  const historical = historicalPaths.map((path, index) => {
    const body = git('show', `${candidate}:${path}`);
    assert.equal(hash(body), hash(readFileSync(join(root, path))));
    writeFileSync(join(output, `historical-${index}.json`), body, { flag: 'wx' });
    return { path, sha256: hash(body), gitBlob: git('rev-parse', `${candidate}:${path}`).toString().trim() };
  });
  preservedBefore = oldInventory(); save('historical-before.json', preservedBefore);
  const tools = ['typescript', 'tsx', 'esbuild', '@esbuild', '@types/node'];
  const toolInventory = tools.map(name => ({ name, entries: inventory(join(root, 'node_modules', name)) }));
  save('toolchain-before.json', toolInventory);
  const oracleRelative = 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr';
  const oracle = join(root, oracleRelative);
  const oracleHash = 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c';
  assert.equal(hash(readFileSync(oracle)), oracleHash);
  const historicalLegacy = JSON.parse(readFileSync(join(output, 'historical-0.json')));
  assert.deepEqual(counts(historicalLegacy), { tests: 241, pass: 240, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  save('provenance.json', { started, baseline, candidate, approvedMigration: freeze.approvedMigration, freezeCommit, selected,
    node: { version: process.version, path: process.execPath, sha256: hash(readFileSync(process.execPath)) }, platform: process.platform, arch: process.arch,
    headAtStart: git('rev-parse', 'HEAD').toString().trim(), liveStatus: git('status', '--short').toString(), stagedAtStart: git('diff', '--cached', '--name-only').toString(),
    historical, oracle: { path: oracle, sha256: oracleHash, policy: 'Existing unchanged canonical tests execute their pinned GNU9.7 Darwin oracle. No new native capture, no new oracle inputs, no Linux claim.' },
    fixture: { originalSha256: hash(original), revisedSha256: hash(revised), onlyExpectedAssertionReplacement: true }, driverSha256: hash(driverBytes),
    authorBindingAtRead: { sha256: hash(newBindingBytes), initiallyUncommitted: true, finalCommitBindingRequired: true } });
  const summaries = {};
  for (const [label, commit] of [['original', baseline], ['revised', candidate]]) {
    const archive = join(work, label); mkdirSync(archive);
    const tarBytes = git('archive', '--format=tar', commit, ...selected);
    const tar = join(work, `${label}.tar`); writeFileSync(tar, tarBytes);
    command(`${label}-extract`, 'tar', ['-xf', tar, '-C', archive], work);
    const before = inventory(archive); sourceBefore.set(label, before);
    const tree = git('ls-tree', '-r', commit, '--', ...selected).toString().trim().split('\n').map(line => {
      const [header, path] = line.split('\t'); const [mode, type, blob] = header.split(' ');
      assert.equal(type, 'blob'); const bytes = readFileSync(join(archive, path));
      assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob, path);
      return { path, mode, blob, sha256: hash(bytes) };
    });
    assert.equal(before.filter(entry => entry.type === 'file').length, tree.length);
    save(`${label}-archive-before.json`, { commit, tarSha256: hash(tarBytes), tree, entries: before });
    symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'));
    command(`${label}-build`, process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], archive);
    const compiled = inventory(join(archive, 'dist')); compiledBefore.set(label, compiled); save(`${label}-compiled-before.json`, compiled);
    mkdirSync(dirname(join(archive, oracleRelative)), { recursive: true }); symlinkSync(oracle, join(archive, oracleRelative));
    const legacy = command(`${label}-legacy241`, process.execPath, historicalLegacy.args, archive, label === 'original' ? 1 : 0);
    const observed = counts(legacy);
    assert.deepEqual(observed, { tests: 241, pass: label === 'original' ? 240 : 241, fail: label === 'original' ? 1 : 0, cancelled: 0, skipped: 0, todo: 0 });
    if (label === 'original') { assert(legacy.stdout.includes('unsupported locales and unrepresentable argv')); assert(legacy.stdout.includes('0 !== 2')); }
    summaries[label] = observed;
    rmSync(join(archive, 'tests/commands/metadata-stress'), { recursive: true });
    if (label === 'revised') {
      const strict = { extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, include: [freeze.fixture, 'tests/commands/expr/named-profile.test.ts'], exclude: [] };
      save('strict-scope.json', strict); writeFileSync(join(archive, 'independent-strict.json'), JSON.stringify(strict));
      command('revised-focused-types', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'independent-strict.json'], archive);
      rmSync(join(archive, 'independent-strict.json'));
      const probe = command('independent-controls', process.execPath, [join(owned, 'probe.mjs'), archive, join(owned, 'FREEZE.json')], archive);
      save('independent-controls-results.json', JSON.parse(probe.stdout));
      const runtimeRows = [];
      for (const input of oldBinding.cases) {
        const child = command(`runtime-${input.id}`, process.execPath, [join(owned, 'runtime-probe.mjs'), join(output, 'runtime-driver.original.mjs'), archive, JSON.stringify(input)], archive);
        runtimeRows.push({ input, actual: JSON.parse(child.stdout) });
      }
      function judge(input, actual) {
        const stdout = Buffer.from(actual.stdoutBase64, 'base64').toString();
        const stderr = Buffer.from(actual.stderrBase64, 'base64').toString();
        let passed = actual.activeAtSettlement === 0 && actual.activeBeforeSafetyCleanup === 0 && actual.activeAfterSafetyCleanup === 0 && !actual.events.includes('workerStart');
        if (input.preabort) passed &&= actual.rejected && actual.exactReasonIdentity && stdout === '' && stderr === '';
        else if (input.expectedError) passed &&= actual.rejected && actual.error?.name === 'RangeError' && actual.error.message === input.expectedError && stdout === '' && stderr === '';
        else if (input.id === 'literal-command-binding') passed &&= !actual.rejected && actual.status === 2 && stdout === '' && stderr === "expr: syntax error: unexpected argument 'x'\n";
        else passed &&= !actual.rejected && actual.status === input.expectedStatus && stderr === input.expectedStderr && (input.stdoutPrefix ? stdout.startsWith(input.stdoutPrefix) : stdout === '');
        return { id: input.id, passed, stdout, stderr, status: actual.status };
      }
      const originalRows = runtimeRows.map(row => judge(row.input, row.actual));
      const revisedRows = runtimeRows.map((row, index) => judge(newBinding.cases[index], row.actual));
      assert.deepEqual(originalRows.filter(row => !row.passed).map(row => row.id), ['syntax-output-one']);
      assert.equal(revisedRows.filter(row => row.passed).length, 12);
      save('runtime-results.json', { runtimeRows, originalRows, revisedRows, original: '11/12', revised: '12/12',
        isolation: 'Each of the exact 12 unchanged inputs ran once in a separate child against revised immutable composition; identical results scored under both immutable expectations.' });
    }
    assert.deepEqual(inventory(join(archive, 'dist')), compiled); save(`${label}-compiled-after.json`, compiled);
    rmSync(join(archive, 'node_modules')); rmSync(join(archive, 'dist'), { recursive: true });
    const after = inventory(archive); assert.deepEqual(after, before, 'full entries, including newly added files/directories');
    save(`${label}-archive-after.json`, after);
  }
  assert.deepEqual(compiledBefore.get('original'), compiledBefore.get('revised'), 'test-only migration preserves all compiled product bytes');
  const historicalAfter = oldInventory(); assert.deepEqual(historicalAfter, preservedBefore); save('historical-after.json', historicalAfter);
  const toolsAfter = tools.map(name => ({ name, entries: inventory(join(root, 'node_modules', name)) })); assert.deepEqual(toolsAfter, toolInventory); save('toolchain-after.json', toolsAfter);
  assert.equal(hash(readFileSync(oracle)), oracleHash);
  save('integrity.json', { archivedGitBlobsAuthenticated: true, bothArchivesUnchangedIncludingAddedEntries: true, compiledUnchanged: true,
    identicalCompiledOldNew: true, fourHistoricalDirectoriesUnchangedIncludingAddedEntries: true, toolchainUnchanged: true, oracleUnchanged: true,
    scope: 'Explicit selected archive inputs, named historical directories, and named toolchain packages only; not a global live-tree gate.' });
  save('summary.json', { started, finished: new Date().toISOString(), baseline, candidate, summaries, negativeControls: '10/10 rejected',
    independentControls: `${freeze.cases.length}/${freeze.cases.length}`, runtimeOriginal: '11/12', runtimeRevised: '12/12',
    historicalOriginal: '240/241 preserved verbatim; new original replay independently 240/241', fullOutputPolicyAccepted: false,
    outputBlocker: 'Separate output-emergency-review-20260827 owns proof; ordinary division writes 23 normal stderr bytes at cap1. Normal quota + at-most-once awaited fixed emergency is not established.',
    nativeCaptureCreated: false, fullGate: false, finalAuthorReceiptBindingPending: true });
} catch (error) {
  save('failure.json', { message: error.message, stack: error.stack });
  throw error;
} finally {
  const integrityOnExit = [];
  for (const [label, before] of sourceBefore) {
    const archive = join(work, label);
    if (existsSync(archive)) integrityOnExit.push({ label, entriesAtExit: inventory(archive), sourceEntriesBefore: before.length });
  }
  save('exit-inventory.json', integrityOnExit);
  rmSync(work, { recursive: true });
  save('cleanup.json', { ownedWork: work, absent: !existsSync(work), childPolicy: 'Every child spawnSync awaited; normal completion required by command receipts. No shared child/process killing.', removedOnlyOwnedWork: true });
}
console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
