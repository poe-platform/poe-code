import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const candidate = 'ea409a6b49d5c1523e3238f0384048218b559c4c';
const candidateMarker = readFileSync('/tmp/safe-bash-env-shebang-guarded-candidate.txt', 'utf8');
assert.equal(candidateMarker.match(/Source\/regressions commit: ([a-f0-9]{40})/u)?.[1], candidate);
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', candidate + '^{commit}']).toString().trim(), candidate);
const output = resolve(owned, 'guarded-ea409a6b-20260827-review1-public-controls');
assert.equal(existsSync(output), false, 'new evidence only');
await mkdir(output);
const scratch = await mkdtemp('/tmp/env-shebang-review-controls-');
const archive = resolve(scratch, 'source');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
const report = { wrapperVersion: 'guarded-public-controls-v1', candidateMarker, predecessorSha256: hash(readFileSync(resolve(owned, 'candidate-controls-dc262a99.mjs'))), candidate, startedAt: new Date().toISOString(), scratch, processes: [], controls: {}, native: [], cleanup: {} };
const save = (name, data) => writeFile(resolve(output, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const groups = [];
async function run(file, args, options = {}) {
  const invocation = { file, args, cwd: options.cwd ?? archive, env: options.env ?? { PATH: '/usr/bin:/bin', LC_ALL: 'C' } };
  const child = spawn(file, args, { ...invocation, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) groups.push(child.pid);
  const stdout = [], stderr = [];
  let length = 0, timeout = false, overflow = false, error;
  const stop = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timeout = true; stop(); }, options.timeout ?? 90000);
  const collect = chunks => bytes => { length += bytes.length; if (length > 4 * 1024 * 1024) { overflow = true; stop(); } else chunks.push(Buffer.from(bytes)); };
  child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
  child.on('error', caught => { error = { code: caught.code, message: caught.message }; });
  const result = await new Promise(done => child.on('close', (status, signal) => { clearTimeout(timer); done({ invocation, pid: child.pid, status, signal, timeout, overflow, error, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64') }); }));
  stop(); report.processes.push({ pid: child.pid, status: result.status, signal: result.signal, timeout, overflow }); return result;
}
function tree(directory) {
  const entries = {};
  const visit = current => { for (const name of readdirSync(current).sort()) { const full = resolve(current, name); const stat = lstatSync(full); if (stat.isDirectory()) visit(full); else if (stat.isFile()) entries[relative(directory, full)] = hash(readFileSync(full)); } };
  visit(directory); return entries;
}
try {
  const selections = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/shell/invocation-cleanup-public.test.ts', 'tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs', 'tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'];
  const paths = git(['ls-tree', '-r', '--name-only', candidate, ...selections]).toString().trim().split('\n');
  report.inputs = Object.fromEntries(paths.map(name => { const bytes = git(['show', `${candidate}:${name}`]); return [name, { sha256: hash(bytes), blob: git(['rev-parse', `${candidate}:${name}`]).toString().trim() }]; }));
  const tar = git(['archive', '--format=tar', candidate, ...selections]);
  report.archiveSha256 = hash(tar);
  await mkdir(archive);
  execFileSync('tar', ['-xf', '-', '-C', archive], { input: tar });
  const checkInputs = () => { for (const [name, value] of Object.entries(report.inputs)) assert.equal(hash(readFileSync(resolve(archive, name))), value.sha256, name); };
  checkInputs();
  const frozen = JSON.parse(readFileSync(resolve(owned, 'seal-v2.json')));
  report.compilerBefore = tree(frozen.compiler.root);
  report.devBefore = tree(frozen.compiler.devRoot);
  assert.deepEqual(report.compilerBefore, frozen.compiler.files);
  assert.deepEqual(report.devBefore, frozen.compiler.devFiles);
  await symlink(frozen.compiler.devRoot, resolve(archive, 'node_modules'));
  report.build = await run(process.execPath, [resolve(frozen.compiler.root, 'bin/tsc'), '-p', 'tsconfig.build.json']);
  await save('build.log', Buffer.from(report.build.stdout, 'base64').toString() + Buffer.from(report.build.stderr, 'base64').toString());
  assert.equal(report.build.status, 0);
  report.distBefore = tree(resolve(archive, 'dist'));
  report.archiveFilesBeforeControls = tree(archive);
  const expectation = {
    format: 'public-cleanup-committed-v1', revision: candidate,
    tree: git(['rev-parse', candidate + '^{tree}']).toString().trim(),
    files: Object.fromEntries(Object.entries(report.inputs).sort(([left], [right]) => left.localeCompare(right)).map(([path, value]) => [path, value.sha256])),
  };
  const expectedPath = resolve(scratch, 'expected.json');
  await writeFile(expectedPath, JSON.stringify(expectation), { flag: 'wx' });
  report.expectation = expectation;
  const result = await run(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', 'tests/shell/invocation-cleanup-public.test.ts'], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: expectedPath, VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: candidate },
  });
  report.controls.publicLifecycle = result;
  await save('public-lifecycle.tap', Buffer.from(result.stdout, 'base64'));
  await save('public-lifecycle.stderr', Buffer.from(result.stderr, 'base64'));
  assert.equal(result.timeout || result.overflow, false);
  assert.equal(result.status, 0, Buffer.from(result.stderr, 'base64').toString());
  const tap = Buffer.from(result.stdout, 'base64').toString();
  report.nestedSnapshotCleanup = [...tap.matchAll(/^# PUBLIC_SNAPSHOT_CLEANUP (.*)$/gmu)].map(match => JSON.parse(match[1]));
  assert.equal(report.nestedSnapshotCleanup.length, 1);
  for (const record of report.nestedSnapshotCleanup) assert.equal(existsSync(record.snapshot), false);
  checkInputs();
  assert.deepEqual(tree(resolve(archive, 'dist')), report.distBefore);
  report.archiveFilesAfterControls = tree(archive);
  assert.deepEqual(report.archiveFilesAfterControls, report.archiveFilesBeforeControls);
  assert.deepEqual(tree(frozen.compiler.root), report.compilerBefore);
  assert.deepEqual(tree(frozen.compiler.devRoot), report.devBefore);
  report.guards = { archiveRegularFileInventoryStable: true, inputsStable: true, distStable: true, compilerStable: true, nestedSnapshotAbsent: true };
} catch (error) {
  report.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.cleanup.groups = groups.map(pid => { try { process.kill(-pid, 'SIGKILL'); } catch {} try { process.kill(-pid, 0); return { pid, absent: false }; } catch (error) { return { pid, absent: error.code === 'ESRCH' }; } });
  await rm(scratch, { recursive: true, force: true });
  report.cleanup.scratchRemoved = !existsSync(scratch);
  report.cleanup.allGroupsAbsent = report.cleanup.groups.every(group => group.absent);
  report.finishedAt = new Date().toISOString();
  await save('report.json', report);
  await save('manifest.json', { files: tree(output), runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), probeSha256: hash(readFileSync(resolve(owned, 'guarded-observe-ea409a6b-v1.mjs'))) });
}
console.log(JSON.stringify({ controls: Object.fromEntries(Object.entries(report.controls).map(([name, result]) => [name, result.status])), failure: report.failure, cleanup: report.cleanup }));
