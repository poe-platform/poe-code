import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const originalPath = 'tests/commands/expr-stress/encounter-final-review-v2-20260827';
const originalCommit = 'beba7b00d5ba277d2ac6770968d8e4b15c846171';
const candidate = 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84';
const label = process.argv[2];
assert(/^[a-z0-9-]+$/u.test(label ?? ''), 'supply unique capture label');
const output = join(owned, label);
assert(!existsSync(output), 'capture refuses overwrite');
mkdirSync(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function command(executable, args, options = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: root, timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
  return { executable, args, cwd: options.cwd ?? root, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() };
}
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function inventory(directory, excluded = []) {
  const entries = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && excluded.includes(entry)) continue;
      const filename = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) entries[filename] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { entries[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else entries[filename] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return entries;
}
function original(name) {
  const bytes = git('show', `${originalCommit}:${originalPath}/${name}`);
  assert.equal(hash(bytes), hash(readFileSync(join(root, originalPath, name))), name);
  return bytes;
}
function tool(path, versionArgs = ['--version']) {
  const realpath = realpathSync(path);
  return { path, realpath, sha256: hash(readFileSync(realpath)), version: command(path, versionArgs) };
}
function pathTool(name) {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    if (!directory) continue;
    const path = join(directory, name);
    try { accessSync(path, constants.X_OK); return path; } catch {}
  }
  throw new Error(`missing executable: ${name}`);
}
function processRows() {
  const result = command('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  assert.equal(result.status, 0);
  return result.stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/u);
    return match && { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
  }).filter(Boolean);
}
const originalCandidate = JSON.parse(original('candidate-01/candidate.json'));
const originalProcess = JSON.parse(original('candidate-01/shared11-process.json'));
const sourceAudit = JSON.parse(original('SOURCE-AUDIT.json'));
assert.equal(originalCandidate.candidate, candidate);
assert.equal(sourceAudit.candidate, candidate);
assert.equal(originalProcess.executable, process.execPath);
const originalSnapshot = inventory(join(root, originalPath));
save('original-review-before.json', originalSnapshot);
for (const name of ['candidate-01/candidate.json', 'candidate-01/shared11-process.json', 'SOURCE-AUDIT.json', 'REPORT.md', 'review.mjs']) {
  writeFileSync(join(output, `original-${name.replaceAll('/', '-')}`), original(name), { flag: 'wx' });
}
const archive = git('archive', '--format=tar', candidate, ...originalCandidate.selected);
assert.equal(hash(archive), originalCandidate.archiveSha256);
const selectedTree = git('ls-tree', '-r', candidate, '--', ...originalCandidate.selected).toString();
assert.equal(selectedTree, originalCandidate.tree);
const scratch = realpathSync(mkdtempSync(join(os.tmpdir(), 'safe-bash-expr-shared-v2-')));
const source = join(scratch, 'source');
const temporary = join(scratch, 'temporary');
mkdirSync(source); mkdirSync(temporary);
const originalTemporary = resolve(originalProcess.cwd, '../temporary');
const environment = { ...process.env, TMPDIR: temporary, TSX_DISABLE_CACHE: '1', GIT_CEILING_DIRECTORIES: originalTemporary };
const processOptions = { cwd: source, env: environment, timeout: 120000, maxBuffer: 32 * 1024 * 1024 };
let fixtureWatch, fixtureTimer, processTimer;
let runnerPid;
const observedProcesses = new Map();
const fixtureRoots = new Map();
let runSettled = true;
let failure;
function observeProcesses() {
  const rows = processRows();
  const relevant = new Set([process.pid, runnerPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (relevant.has(row.ppid) && !relevant.has(row.pid)) { relevant.add(row.pid); changed = true; }
  }
  for (const row of rows) if (row.pid !== process.pid && row.command !== '/bin/ps -axo pid=,ppid=,command=' && (relevant.has(row.pid) || row.command.includes(scratch))) observedProcesses.set(row.pid, row);
}
function observeFixtures() {
  for (const name of readdirSync(temporary)) {
    if (!name.startsWith('virtual-rg-native-')) continue;
    const path = join(temporary, name);
    try {
      const realpath = realpathSync(path);
      assert.equal(dirname(realpath), temporary);
      const entry = fixtureRoots.get(realpath) ?? { realpath, parentRealpath: realpathSync(dirname(path)), firstObserved: new Date().toISOString(), runnerPid, snapshots: [] };
      const names = readdirSync(path).sort();
      const snapshot = { names, gitMarkerPresent: existsSync(join(path, '.git')), gitignore: existsSync(join(path, '.gitignore')) ? readFileSync(join(path, '.gitignore')).toString() : null };
      if (JSON.stringify(entry.snapshots.at(-1)) !== JSON.stringify(snapshot)) entry.snapshots.push(snapshot);
      fixtureRoots.set(realpath, entry);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function discovery(directory) {
  const env = { PATH: process.env.PATH, LC_ALL: 'C', LANG: 'C', HOME: scratch };
  const result = command(pathTool('git'), ['-C', directory, 'rev-parse', '--show-toplevel'], { env, timeout: 3000 });
  assert.equal(result.status, 128, JSON.stringify(result));
  assert.match(result.stderr, /not a git repository/u);
  assert.equal(result.signal, null);
  const ancestors = [];
  for (let current = realpathSync(directory);; current = dirname(current)) {
    ancestors.push({ realpath: current, gitMarkerPresent: existsSync(join(current, '.git')) });
    assert(!ancestors.at(-1).gitMarkerPresent);
    if (current === dirname(current)) break;
  }
  return { result, environment: env, excludesAllGitEnvironmentOverrides: true, ancestors };
}
try {
  save('git-discovery-before.json', { scratch: discovery(scratch), fixtureParent: discovery(temporary) });
  writeFileSync(join(scratch, 'candidate.tar'), archive, { flag: 'wx' });
  const extraction = command(pathTool('tar'), ['-xf', '-', '-C', source], { input: archive });
  save('extract-process.json', extraction);
  assert.equal(extraction.status, 0);
  const sourceBefore = inventory(source);
  assert.deepEqual(sourceBefore, JSON.parse(original('candidate-01/source-before.json')));
  const files = Object.entries(sourceBefore).filter(([, entry]) => entry.kind === 'file');
  assert.equal(files.length, 349);
  for (const [filename, entry] of files) assert.equal(hash(git('show', `${candidate}:${filename}`)), entry.sha256, filename);
  for (const entry of [...sourceAudit.sourceFiles, ...sourceAudit.sharedHashes]) assert.equal(sourceBefore[entry.filename].sha256, entry.sha256, entry.filename);
  const globPath = 'tests/commands/regex-execution/continuation/glob.test.ts';
  assert.equal(hash(git('show', `ec59c917ba137126a064960995b5fc6945ea8f6d:${globPath}`)), sourceBefore[globPath].sha256);
  save('source-before.json', sourceBefore);
  save('candidate.json', { ...originalCandidate, authenticatedFileCount: files.length, selectedTree, globEc59Included: sourceAudit.sharedHashes.find(entry => entry.filename === globPath) });
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const toolingBefore = inventory(join(root, 'node_modules'));
  save('tooling-before.json', toolingBefore);
  const nativePath = pathTool('rg');
  const nativeBefore = tool(nativePath);
  assert.equal(nativeBefore.version.status, 0);
  assert.equal(nativeBefore.sha256, JSON.parse(original('NATIVE-RG-POSTRUN.json')).sha256);
  save('native-before.json', nativeBefore);
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  save('qualification.json', { node: tool(process.execPath), compiler: { ...tool(compiler), versionViaNode: command(process.execPath, [compiler, '--version']) }, tsxPackage: JSON.parse(readFileSync(join(root, 'node_modules/tsx/package.json'))).version, platform: process.platform, release: os.release(), arch: process.arch, git: tool(pathTool('git')), tar: tool(pathTool('tar')), helper: { sha256: sourceBefore['tests/commands/search/helpers.ts'].sha256, nativeLocation: 'realpath(await mkdtemp(join(tmpdir(), "virtual-rg-native-")))', nativeArgv: ['--no-config', '--no-ignore-parent', '--no-ignore-global', '--sort=path', '...fixture.args'], nativeEnv: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '<fixture root>', TMPDIR: '<fixture root>' }, timeout: 3000, maxOutputBytes: 1048576, vfs: 'MemoryFileSystem rooted at /work; no implicit host Git parent; unchanged candidate helper' } });
  const relevantEnvironment = Object.fromEntries(Object.entries(environment).filter(([name]) => /^(PATH|TMPDIR|TMP|TEMP|TSX_|NODE_|GIT_|LC_|LANG$|TZ$|HOME$|CI$|FORCE_COLOR$|NO_COLOR$)/u.test(name)));
  const manifest = { frozenAt: new Date().toISOString(), candidate, originalCommit, originalArchiveSha256: hash(archive), originalCommandSha256: hash(original('candidate-01/shared11-process.json')), sourceInventorySha256: hash(readFileSync(join(output, 'source-before.json'))), harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), command: { executable: originalProcess.executable, args: originalProcess.args, cwd: source, timeout: 120000, maxBuffer: 33554432, killSignal: 'SIGTERM', concurrency: 'unchanged Node default; no concurrency argv', stdin: 'empty pipe, matching spawnSync default' }, originalCwd: originalProcess.cwd, originalTemporary, scratch, tmpdirRealpath: realpathSync(temporary), changes: ['Fresh physical TMPDIR outside every Git ancestor', 'Isolated source/build cwd relocated into the same freshly owned OS-temp directory'], preserved: { TSX_DISABLE_CACHE: '1 (already set by original driver)', GIT_CEILING_DIRECTORIES: originalTemporary, otherEnvironment: 'spread process.env exactly as original driver; no additional injected flags', timeouts: 'original 120000ms command / 3000ms native / 30000ms public-child unchanged', nativeProfile: 'same rg binary hash; no flags/assertions/fixtures changed', assertions: 'all 349 candidate files and all eleven argv test paths authenticated', noOtherCohorts: '61/21/moved19 and other old review cohorts not run' }, environment: relevantEnvironment, ambientEnvironmentDigest: hash(JSON.stringify(Object.entries(process.env).sort())), limitation: 'Original inherited ambient environment was not captured. Current inheritance and explicit overrides are recorded; historical ambient equality cannot be proven. GIT_CEILING_DIRECTORIES retains the original ineffective value and is not relied upon.', observation: 'Read-only parent filesystem/process sampling; no test preload, interception, native wrapper or source overlay', expected: { tests: 276, pass: 276, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, originalOutcome: { tests: 276, pass: 275, fail: 1 }, cleanup: 'Only exact mkdtemp-owned directory, after children exit; no SIGSTOP' };
  save('CORRECTION-MANIFEST.json', manifest);
  const manifestHash = hash(readFileSync(join(output, 'CORRECTION-MANIFEST.json')));
  save('FREEZE.json', { frozenAt: new Date().toISOString(), manifestSha256: manifestHash, sourceArchiveSha256: hash(archive) });
  const startup = command(process.execPath, ['--input-type=module', '-e', 'import os from "node:os"; import fs from "node:fs"; console.log(JSON.stringify({pid:process.pid,TMPDIR:process.env.TMPDIR,tmpdir:os.tmpdir(),realpath:fs.realpathSync(os.tmpdir()),TSX_DISABLE_CACHE:process.env.TSX_DISABLE_CACHE,GIT_CEILING_DIRECTORIES:process.env.GIT_CEILING_DIRECTORIES}));'], processOptions);
  save('startup-probe-process.json', startup);
  assert.equal(startup.status, 0);
  assert.equal(JSON.parse(startup.stdout).realpath, temporary);
  const build = command(process.execPath, [compiler, '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], processOptions);
  save('build-process.json', build);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const builtBefore = inventory(join(source, 'dist'));
  save('build-before.json', builtBefore);
  const runtimeBefore = inventory(source);
  save('runtime-before.json', runtimeBefore);
  fixtureWatch = watch(temporary, observeFixtures);
  fixtureTimer = setInterval(observeFixtures, 5);
  processTimer = setInterval(observeProcesses, 100);
  const started = new Date().toISOString();
  runSettled = false;
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(originalProcess.executable, originalProcess.args, { cwd: source, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    runnerPid = child.pid;
    const stdout = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, error = null;
    const timer = setTimeout(() => { error = 'original 120000ms command timeout'; child.kill('SIGTERM'); }, 120000);
    child.on('error', caught => { error = caught.message; });
    child.stdout.on('data', bytes => { stdoutBytes += bytes.length; stdout.push(Buffer.from(bytes)); if (stdoutBytes > 33554432) { error = 'stdout maxBuffer exceeded'; child.kill('SIGTERM'); } });
    child.stderr.on('data', bytes => { stderrBytes += bytes.length; stderr.push(Buffer.from(bytes)); if (stderrBytes > 33554432) { error = 'stderr maxBuffer exceeded'; child.kill('SIGTERM'); } });
    child.on('close', (status, signal) => {
      clearTimeout(timer); runSettled = true;
      const stdoutBuffer = Buffer.concat(stdout), stderrBuffer = Buffer.concat(stderr);
      writeFileSync(join(output, 'shared11.stdout.txt'), stdoutBuffer, { flag: 'wx' });
      writeFileSync(join(output, 'shared11.stderr.txt'), stderrBuffer, { flag: 'wx' });
      resolveResult({ executable: originalProcess.executable, args: originalProcess.args, cwd: source, pid: child.pid, started, finished: new Date().toISOString(), status, signal, error, stdout: stdoutBuffer.toString(), stderr: stderrBuffer.toString() });
    });
    child.stdin.on('error', rejectResult);
    child.stdin.end();
  });
  clearInterval(fixtureTimer); clearInterval(processTimer); fixtureWatch.close();
  observeFixtures(); observeProcesses();
  save('shared11-process.json', result);
  const counts = Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  save('SUMMARY.json', { candidate, originalCommit, original: manifest.originalOutcome, corrected: { status: result.status, signal: result.signal, error: result.error, ...counts }, separatelyQualified: true, setupOnly: true, noOriginalResultRewrite: true, failingCase: { name: 'rg native differential: gitignore requires git by default', passed: result.stdout.includes('✔ rg native differential: gitignore requires git by default') }, nativeObservedRoots: fixtureRoots.size, manifestSha256: manifestHash });
  save('native-fixture-observations.json', { actualRun: { pid: runnerPid, started, finished: result.finished, inheritedStartupTMPDIR: temporary }, helperSha256: sourceBefore['tests/commands/search/helpers.ts'].sha256, observations: [...fixtureRoots.values()], caveat: 'Read-only best-effort sampling, not a complete native-spawn trace; native output bytes remain governed by unchanged differential assertions, not separately intercepted.' });
  save('process-observations.json', [...observedProcesses.values()]);
  save('git-discovery-after.json', { scratch: discovery(scratch), fixtureParent: discovery(temporary) });
  const runtimeAfter = inventory(source);
  const builtAfter = inventory(join(source, 'dist'));
  const sourceAfter = inventory(source, ['node_modules', 'dist']);
  save('runtime-after.json', runtimeAfter); save('build-after.json', builtAfter); save('source-after.json', sourceAfter);
  assert.deepEqual(runtimeAfter, runtimeBefore);
  assert.deepEqual(builtAfter, builtBefore);
  assert.deepEqual(sourceAfter, sourceBefore);
  const toolingAfter = inventory(join(root, 'node_modules'));
  save('tooling-after.json', toolingAfter);
  assert.deepEqual(toolingAfter, toolingBefore);
  const nativeAfter = tool(nativePath);
  save('native-after.json', nativeAfter);
  assert.equal(nativeAfter.sha256, nativeBefore.sha256);
  assert.equal(nativeAfter.version.stdout, nativeBefore.version.stdout);
  assert.equal(hash(readFileSync(join(scratch, 'candidate.tar'))), hash(archive));
  assert.equal(hash(git('archive', '--format=tar', candidate, ...originalCandidate.selected)), hash(archive));
  assert.equal(hash(readFileSync(join(output, 'CORRECTION-MANIFEST.json'))), manifestHash);
  const originalAfter = inventory(join(root, originalPath));
  save('original-review-after.json', originalAfter);
  assert.deepEqual(originalAfter, originalSnapshot);
  save('INTEGRITY.json', { candidate, sourceFileCount: files.length, archiveSha256: hash(archive), fullSourceAndBuildEntrySetsUnchanged: true, detectsAddedRemovedChangedEntries: true, toolingEntrySetsUnchanged: true, originalReviewEntrySetsUnchanged: true, manifestUnchanged: true, nativeBinaryUnchanged: true, scope: 'Selected candidate source/test/root inputs, isolated build, existing tooling, old review; observation-time checks, not transient mutation detection or global live-tree proof' });
  assert(fixtureRoots.size > 0, 'actual native fixture roots must be observed');
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.error, null);
  assert.deepEqual(counts, manifest.expected);
} catch (error) {
  failure = error;
  save('FAILURE.json', { message: error.message, stack: error.stack, classification: 'Do not rebaseline; inspect exact captured setup/runtime evidence' });
} finally {
  clearInterval(fixtureTimer); clearInterval(processTimer); fixtureWatch?.close();
  const rows = processRows();
  const remaining = rows.filter(row => row.pid !== process.pid && (row.command.includes(scratch) || observedProcesses.has(row.pid)));
  const beforeRemoval = inventory(scratch);
  save('cleanup-before.json', { scratch, runSettled, remaining, entries: beforeRemoval, fixtureParentEntries: readdirSync(temporary) });
  assert(runSettled && remaining.length === 0, 'refuse deletion while owned children remain');
  assert(dirname(scratch) === realpathSync(os.tmpdir()) && scratch.split('/').at(-1).startsWith('safe-bash-expr-shared-v2-'));
  rmSync(scratch, { recursive: true, force: false });
  const afterRows = processRows();
  const remainingAfter = afterRows.filter(row => row.pid !== process.pid && (row.command.includes(scratch) || observedProcesses.has(row.pid)));
  save('CLEANUP.json', { removedExactDirectory: scratch, absent: !existsSync(scratch), remainingOwnedProcesses: remainingAfter, childrenSettledBeforeDeletion: runSettled && remaining.length === 0, sigstopUsed: false, workerQualification: 'Shared runner and test processes exited normally; no separate thread-level observer injected. Worker threads cannot survive their exited owning process.', completedAt: new Date().toISOString() });
  assert.equal(remainingAfter.length, 0);
}
if (failure) throw failure;
console.log(JSON.stringify(JSON.parse(readFileSync(join(output, 'SUMMARY.json')))));
