import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import os from 'node:os';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const independent = join(root, 'tests/commands/expr-stress/encounter-independent-v2-20260827');
const testCommit = 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84';
const quotaCommit = 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee';
const [mode, sourceRef, name] = process.argv.slice(2);
assert(mode === '--capture' && /^[a-f0-9]{8,40}$/u.test(sourceRef ?? '') && /^[a-z0-9-]+$/u.test(name ?? ''), 'capture.mjs --capture COMMIT UNIQUE-NAME');
const output = join(owned, name);
assert(!existsSync(output), 'immutable output already exists');
mkdirSync(output);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (filename, value) => writeFileSync(join(output, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function command(executable, args, cwd = root, timeout = 90000) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1', TSX_DISABLE_CACHE: '1' } });
  return { executable, args, cwd, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}
function git(...args) {
  const result = command('git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function inventory(directory, excludes = []) {
  const result = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && excludes.includes(entry)) continue;
      const path = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) result[path] = { symlink: readlinkSync(absolute) };
      else if (stat.isDirectory()) { result[path] = { directory: true }; walk(absolute, path); }
      else result[path] = { bytes: stat.size, sha256: sha256(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return result;
}
function frozenInputs() {
  const result = {};
  for (const path of ['freeze/original-cases.json', 'freeze/original-driver.mjs', 'freeze/controls.json', 'nearby-driver.mjs', 'freeze/manifest.json']) {
    const expected = git('show', `30dda5b9:tests/commands/expr-stress/encounter-independent-v2-20260827/${path}`);
    const actual = readFileSync(join(independent, path));
    assert.equal(sha256(actual), sha256(expected), path);
    result[path] = sha256(actual);
  }
  const freeze = JSON.parse(readFileSync(join(owned, 'focused-freeze.json')));
  const path = 'tests/commands/expr/encounter-order.test.ts';
  assert.equal(sha256(git('show', `${testCommit}:${path}`)), freeze.files[path]);
  result.focusedTest = freeze.files[path];
  return result;
}
const temporaryParent = join(owned, 'node_modules');
const scratch = join(temporaryParent, name);
const createdParent = !existsSync(temporaryParent);
assert(!existsSync(scratch), 'scratch already exists');
let before, compiledBefore;
try {
  save('freeze-before.json', frozenInputs());
  const sourceCommit = git('rev-parse', sourceRef).trim();
  assert.equal(command('git', ['merge-base', '--is-ancestor', quotaCommit, sourceCommit]).status, 0, 'candidate must include quota release');
  const testPaths = git('ls-tree', '-r', '--name-only', testCommit, '--', 'tests/commands/expr').trim().split('\n').filter(path => path.endsWith('.ts'));
  const sharedTests = ['tests/commands/regex-execution/commands.test.ts', 'tests/commands/regex-execution/executor.test.ts', 'tests/commands/expr/regex-protocol.test.ts'];
  const queue = [...testPaths, ...sharedTests, 'src/commands/regex-execution/worker.ts'];
  const source = {}, bindings = {};
  while (queue.length) {
    const filename = queue.pop();
    if (Object.hasOwn(source, filename)) continue;
    assert(filename.startsWith('src/') || filename.startsWith('tests/'), filename);
    const commit = filename.startsWith('src/') ? sourceCommit : testCommit;
    const text = git('show', `${commit}:${filename}`);
    source[filename] = text;
    bindings[filename] = { commit, sha256: sha256(text) };
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/gu)) {
      queue.push(posix.normalize(posix.join(posix.dirname(filename), match[1])).replace(/\.js$/u, '.ts'));
    }
  }
  for (const filename of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) {
    source[filename] = git('show', `${sourceCommit}:${filename}`);
    bindings[filename] = { commit: sourceCommit, sha256: sha256(source[filename]) };
  }
  const ordered = Object.fromEntries(Object.entries(source).sort(([left], [right]) => left.localeCompare(right)));
  const bytes = Buffer.from(`${JSON.stringify(ordered)}\n`), compressed = gzipSync(bytes);
  writeFileSync(join(output, 'source-archive.b64.data'), `${compressed.toString('base64')}\n`, { flag: 'wx' });
  save('bindings.json', bindings);
  const nativeTests = testPaths.filter(path => path.endsWith('/native.test.ts') || path.endsWith('/regex-native.test.ts'));
  const exprTests = testPaths.filter(path => path.endsWith('.test.ts') && !nativeTests.includes(path));
  save('provenance.json', { sourceCommit, quotaCommit, testCommit, sourcePolicy: 'Committed relative-import closure only. Tests bind the candidate test commit even on quota-only baseline; no live source overlays.', sourceFiles: Object.keys(source).length, compressedBytes: compressed.length, archiveSha256: sha256(compressed), expandedSha256: sha256(bytes), node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), native: 'No native execution. Authenticated historical GNU9.7 Darwin expectations only; no Linux claim.', exprTests, sharedTests, nativeTestsNotExecuted: nativeTests, declarations: 'source build, not full public-consumer or deployed-provider acceptance' });
  mkdirSync(scratch, { recursive: true });
  for (const [filename, text] of Object.entries(ordered)) {
    const destination = resolve(scratch, filename);
    assert(destination.startsWith(`${scratch}/`));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text, { flag: 'wx' });
  }
  writeFileSync(join(scratch, 'encounter-types.json'), `${JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, include: [], exclude: [], files: Object.keys(source).filter(path => path.endsWith('.ts')) })}\n`, { flag: 'wx' });
  before = inventory(scratch);
  save('source-before.json', before);
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  for (const [label, config] of [['build', 'tsconfig.build.json'], ['types', 'encounter-types.json']]) {
    const result = command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config, '--skipLibCheck', 'false'], scratch);
    save(`${label}.json`, result);
    assert.equal(result.status, 0, result.stdout || result.stderr);
  }
  compiledBefore = inventory(join(scratch, 'dist'));
  save('compiled-before.json', compiledBefore);
  const results = {};
  for (const [label, driver, inputs] of [['original', 'freeze/original-driver.mjs', 'freeze/original-cases.json'], ['nearby', 'nearby-driver.mjs', 'freeze/controls.json']]) {
    const execution = command(process.execPath, ['--unhandled-rejections=strict', join(independent, driver), scratch, join(independent, inputs)], scratch);
    save(`${label}-execution.json`, execution);
    assert.equal(execution.status, 0, execution.stderr);
    results[label] = JSON.parse(execution.stdout);
    save(`${label}-results.json`, results[label]);
  }
  function testRun(label, paths) {
    const execution = command(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...paths], scratch, 120000);
    save(`${label}-execution.json`, execution);
    assert(!execution.error && !execution.signal, 'test infrastructure failure');
    writeFileSync(join(output, `${label}.tap`), execution.stdout, { flag: 'wx' });
    return { status: execution.status, counts: Object.fromEntries([...execution.stdout.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])), failed: execution.stdout.split('\n').filter(line => line.startsWith('not ok ')) };
  }
  const expr = testRun('expr', exprTests);
  const shared = testRun('shared', sharedTests);
  const cohort = cases => ({ passed: cases.filter(specimen => specimen.passed).length, total: cases.length, failures: cases.filter(specimen => !specimen.passed).map(specimen => ({ id: specimen.id, failures: specimen.failures })) });
  const frozen = JSON.parse(readFileSync(join(independent, 'freeze/original-cases.json')));
  save('summary.json', { sourceCommit, quotaCommit, original: cohort(results.original.cases), nativeSubset: cohort(results.original.cases.filter((specimen, index) => frozen.cases[index].native !== false)), projectSubset: cohort(results.original.cases.filter((specimen, index) => frozen.cases[index].native === false)), shell: cohort(results.original.shell), oldCapSeparate: results.original.oldCap, nearby: cohort(results.nearby.cases), expr, shared, activeWorkers: { original: results.original.activeWorkers, nearby: results.nearby.activeWorkers }, build: 'passed', strictTypes: 'passed' });
  assert.equal(sha256(Buffer.from(readFileSync(join(output, 'source-archive.b64.data'), 'utf8').trim(), 'base64')), sha256(compressed));
} finally {
  try {
    if (before) {
      const after = inventory(scratch, ['node_modules', 'dist']);
      save('source-after.json', after);
      assert.deepEqual(after, before, 'append-aware complete source/tests inventory');
    }
    if (compiledBefore) {
      const after = inventory(join(scratch, 'dist'));
      save('compiled-after.json', after);
      assert.deepEqual(after, compiledBefore, 'append-aware complete compiled inventory');
    }
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { recursive: true });
    if (createdParent && existsSync(temporaryParent)) rmdirSync(temporaryParent);
    save('freeze-after.json', frozenInputs());
    save('cleanup.json', { scratchAbsent: !existsSync(scratch), parentAbsent: !existsSync(temporaryParent), children: 'synchronous children waited, driver workers awaited; no SIGSTOP', integrity: 'full extracted source/tests and compiled inventories detect new entries too; authenticated original freeze paths checked before/after; no append-proof claim for independent evidence directory' });
  }
}
console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
