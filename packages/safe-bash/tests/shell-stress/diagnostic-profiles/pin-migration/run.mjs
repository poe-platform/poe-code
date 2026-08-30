import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scope = dirname(fileURLToPath(import.meta.url));
const root = resolve(scope, '../../../..');
const scopePath = relative(root, scope);
const candidate = process.argv[2];
assert.match(candidate ?? '', /^[0-9a-f]{40}$/u, 'Supply the frozen full candidate commit before execution');
const outputName = process.argv[3] ?? 'execution';
assert.match(outputName, /^execution(?:-[a-z0-9-]+)?$/u, 'Use a fresh execution evidence leaf');
const output = join(scope, outputName);
assert.equal(existsSync(output), false, 'Evidence is append-only; do not overwrite a run');
mkdirSync(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
const show = path => git(['show', `${candidate}:${path}`]);
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const authentication = JSON.parse(readFileSync(join(scope, 'authentication.json')));
const baselinePath = authentication.baseline.path;
const baseline = JSON.parse(show(baselinePath));
const testPath = 'tests/shell-stress/diagnostic-profiles/compatibility.test.ts';
const profilePath = 'tests/shell-stress/diagnostic-profiles/profile.ts';
const bindingPath = `${scopePath}/current-binding.ts`;
const controlPath = `${scopePath}/binding.test.ts`;
const roots = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', ...Object.keys(baseline.sources).filter(path => path.startsWith('tests/')), 'tests/shell-stress/virtual-child.ts', testPath, profilePath, bindingPath, baselinePath];
const paths = git(['ls-tree', '-r', '--name-only', candidate, '--', ...roots]).toString().trim().split('\n');
const scratch = mkdtempSync(join(tmpdir(), 'safe-bash-diagnostic-pins-run-'));
const source = join(scratch, 'source');
const temporary = join(scratch, 'tmp');
mkdirSync(source);
mkdirSync(temporary);
const environment = { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1' };
const runs = [];
const startedAt = new Date().toISOString();
let failure;

function inventory(directory, prefix = '') {
  const entries = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(entries, inventory(path, `${key}/`));
    else {
      assert.ok(entry.isFile(), `Only regular copied inputs are admitted: ${path}`);
      entries[key] = hash(readFileSync(path));
    }
  }
  return entries;
}

function run(label, args, cwd, extraEnvironment = {}, timeout = 240000) {
  const command = [process.execPath, ...args];
  const begin = Date.now();
  const result = spawnSync(command[0], command.slice(1), { cwd, env: { ...environment, ...extraEnvironment }, detached: true, timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  let processGroupClosed = false;
  if (result.pid) {
    try { process.kill(-result.pid, 0); process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code === 'ESRCH') processGroupClosed = true; else throw error; }
  }
  writeFileSync(join(output, `${label}.stdout.tap`), result.stdout ?? Buffer.alloc(0), { flag: 'wx' });
  writeFileSync(join(output, `${label}.stderr.log`), result.stderr ?? Buffer.alloc(0), { flag: 'wx' });
  const text = result.stdout?.toString() ?? '';
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'mu'))?.[1] ?? -1)]));
  const rows = [...text.matchAll(/^(not ok|ok) \d+ - (.+)$/gmu)].map(match => ({ pass: match[1] === 'ok', name: match[2] }));
  const cohortCounts = Object.fromEntries(['original-differential', 'original-syntax', 'current-gaps', 'identity'].map(cohort => {
    const members = rows.filter(row => cohort === 'identity' ? row.name.includes(': pinned identity and original native lifecycle control') : row.name.includes(`: ${cohort}: `));
    return [cohort, { tests: members.length, pass: members.filter(row => row.pass).length, fail: members.filter(row => !row.pass).length }];
  }));
  const record = { label, command, cwd, environment: { ...environment, ...extraEnvironment }, timeout, maxBuffer: 16 * 1024 * 1024, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, elapsedMs: Date.now() - begin, counts, cohortCounts, hookFailures: (text.match(/failureType: 'hookFailed'/gu) ?? []).length, failures: rows.filter(row => !row.pass).map(row => row.name), stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''), processGroupClosed };
  save(`${label}.json`, record);
  runs.push(record);
  console.log(JSON.stringify({ label, status: record.status, counts, hookFailures: record.hookFailures }));
  assert.equal(result.error, undefined, label);
  assert.equal(result.signal, null, label);
  assert.equal(result.stderr.length, 0, label);
  assert.equal(processGroupClosed, true, label);
  return record;
}

function assertWholeCohort(record) {
  assert.equal(record.counts.tests, 89);
  assert.equal(record.counts.pass + record.counts.fail, 89);
  for (const key of ['cancelled', 'skipped', 'todo']) assert.equal(record.counts[key], 0);
  assert.deepEqual(Object.values(record.cohortCounts).map(cohort => cohort.tests), [72, 5, 11, 1]);
}

try {
  const ownPaths = git(['ls-tree', '-r', '--name-only', candidate, '--', scopePath, testPath, profilePath]).toString().trim().split('\n');
  for (const path of ownPaths) assert.deepEqual(readFileSync(join(root, path)), show(path), `Frozen author input changed: ${path}`);
  const inputs = {};
  for (const path of paths) {
    const bytes = show(path);
    const worktreeSha256 = hash(readFileSync(join(root, path)));
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), bytes, { flag: 'wx' });
    inputs[path] = { sha256: hash(bytes), bytes: bytes.length, worktreeSha256, worktreeMatchesCommitted: worktreeSha256 === hash(bytes) };
  }
  assert.equal(inputs[baselinePath].sha256, authentication.baseline.sha256);
  for (const driver of authentication.drivers) assert.equal(inputs[driver.path].sha256, driver.currentSha256);
  const tooling = {};
  for (const packagePath of ['tsx', 'esbuild', `@esbuild/${process.platform}-${process.arch}`]) {
    const installed = join(root, 'node_modules', packagePath);
    const copied = join(source, 'node_modules', packagePath);
    const before = inventory(installed);
    cpSync(installed, copied, { recursive: true, errorOnExist: true, force: false });
    assert.deepEqual(inventory(copied), before);
    tooling[packagePath] = { version: JSON.parse(readFileSync(join(copied, 'package.json'))).version, files: before };
  }
  const nativePrerequisites = [];
  for (const name of ['primary-5.3', 'historical-3.2']) {
    const profile = baseline.profiles.find(profile => profile.name === name);
    assert.ok(profile);
    assert.equal(hash(readFileSync(profile.executable)), profile.sha256, `Missing or changed ${name} native prerequisite`);
    nativePrerequisites.push(profile);
  }
  const sourceHashes = inventory(join(source, 'src'), 'src/');
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tests/fixtures/shell-cases.json']) sourceHashes[path] = inputs[path].sha256;
  save('prerequisites.json', { startedAt, candidate, liveHeadAtStart: git(['rev-parse', 'HEAD']).toString().trim(), dirtyStatusAtStart: git(['status', '--short']).toString(), inputs, sourceEvidenceAggregate: hash(JSON.stringify(sourceHashes)), node: { executable: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, tooling, nativePrerequisites, nativeUtilities: ['/bin/cat', '/usr/bin/head'].map(path => ({ path, sha256: hash(readFileSync(path)) })), parentUmask: process.umask(), isolatedSourceNoGitMetadata: true, note: 'Actual product source and installed tools are regular authenticated copies; no dist or node_modules network installation. Helper revision strings are empty outside Git; candidate and full hashes here provide attribution. Darwin native utilities, not a GNU/Linux profile. No timing/performance conclusion.' });
  const nativeRoot = join(source, 'benchmarks/shell-stress/diagnostic-profiles');
  const checkScratch = () => assert.deepEqual(readdirSync(nativeRoot).filter(name => name.startsWith('.native-') || name.startsWith('.identity-')), []);
  for (const name of ['primary-5.3', 'historical-3.2']) {
    const record = run(name, ['--import', 'tsx', '--test', '--test-reporter=tap', testPath], source, { VIRTUAL_BASH_DIAGNOSTIC_PROFILE: name });
    assertWholeCohort(record);
    assert.equal(record.hookFailures, 0);
    assert.equal(record.cohortCounts.identity.pass, 1);
    checkScratch();
  }
  const controls = run('binding-controls', ['--import', 'tsx', '--test', '--test-reporter=tap', controlPath], root, { TSX_TSCONFIG_PATH: join(source, 'tsconfig.json') });
  assert.deepEqual(controls.counts, { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  for (const [index, driver] of authentication.drivers.entries()) {
    const path = join(source, driver.path);
    assert.ok(lstatSync(path).isFile());
    assert.equal(lstatSync(path).isSymbolicLink(), false);
    const original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]));
      const record = run(`mutated-driver-${index + 1}`, ['--import', 'tsx', '--test', '--test-reporter=tap', testPath], source, { VIRTUAL_BASH_DIAGNOSTIC_PROFILE: 'primary-5.3' });
      assertWholeCohort(record);
      assert.equal(record.counts.fail, 89);
      assert.equal(record.hookFailures, 89);
      assert.equal(record.status, 1);
      assert.ok(readFileSync(join(output, `${record.label}.stdout.tap`), 'utf8').includes(`Current fixture/helper binding changed: ${driver.path}`));
      checkScratch();
    } finally { writeFileSync(path, original); }
  }
  for (const driver of authentication.drivers) {
    const bytes = git(['show', `${driver.historicalCommit}:${driver.path}`]);
    assert.equal(hash(bytes), driver.historicalSha256);
    writeFileSync(join(source, driver.path), bytes);
  }
  try {
    const replay = run('historical-guard-replay', ['--import', 'tsx', '--input-type=module', '-e', `import { validateFrozenProfile } from './${profilePath}'; validateFrozenProfile(); console.log('Historical guard accepted sealed original driver bytes');`], source, { VIRTUAL_BASH_DIAGNOSTIC_PROFILE: 'primary-5.3' });
    assert.equal(replay.status, 0);
    checkScratch();
  } finally {
    for (const driver of authentication.drivers) writeFileSync(join(source, driver.path), show(driver.path));
  }
  for (const [path, expected] of Object.entries(inputs)) assert.equal(hash(readFileSync(join(source, path))), expected.sha256, `Copied source/test changed: ${path}`);
  for (const [packagePath, expected] of Object.entries(tooling)) {
    assert.deepEqual(inventory(join(source, 'node_modules', packagePath)), expected.files);
    assert.deepEqual(inventory(join(root, 'node_modules', packagePath)), expected.files);
  }
  for (const profile of nativePrerequisites) assert.equal(hash(readFileSync(profile.executable)), profile.sha256);
  for (const path of ownPaths) assert.deepEqual(readFileSync(join(root, path)), show(path), `Frozen author input changed during run: ${path}`);
  save('postflight.json', { candidate, copiedInputsUnchanged: paths.length, copiedAndInstalledToolingUnchanged: true, nativeBinariesUnchanged: true, canonicalFrozenFilesUnchanged: ownPaths.length, liveHeadAtFinish: git(['rev-parse', 'HEAD']).toString().trim(), dirtyStatusAtFinish: git(['status', '--short']).toString() });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
  save('summary.json', { candidate, startedAt, finishedAt: new Date().toISOString(), failure: failure ?? null, runs, cleanup: { scratch, removed: !existsSync(scratch), runnerGroupsClosed: runs.every(record => record.processGroupClosed), nativeAndVirtualChildrenUseOriginalBoundedIsolatedSpawn: true }, authorValidationOnly: true, independentAcceptance: false });
}
if (failure) console.error(failure);
