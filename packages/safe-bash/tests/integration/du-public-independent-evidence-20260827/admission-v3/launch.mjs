import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [commit, digest] = process.argv.slice(2);
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
assert.match(digest ?? '', /^[a-f0-9]{64}$/u);
const repository = '/Users/kjopek/Workspace/safe-bash';
const directory = dirname(fileURLToPath(import.meta.url));
const owner = dirname(directory);
const base = join(owner, 'admission-v2');
const run = join(owner, 'run-v3');
const work = join(run, 'node_modules/work');
const actualGit = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const actualNode = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const started = Date.now();
const state = { commit, manifestSha256: digest, startedAt: new Date(started).toISOString(), childrenStarted: 0, childrenClosed: 0, childProcessesActive: 0, handedToExecutor: false, failure: null };
assert.ok(!existsSync(run), 'one attempt only; no existing run directory');
mkdirSync(run, { mode: 0o755 });
mkdirSync(join(work, 'home'), { recursive: true, mode: 0o755 });
mkdirSync(join(work, 'tmp'), { recursive: true, mode: 0o755 });
const receipt = () => writeFileSync(join(run, 'LAUNCH-RESULT.json'), `${JSON.stringify(state, null, 2)}\n`);
const event = record => appendFileSync(join(run, 'launch-events.jsonl'), `${JSON.stringify({ elapsedMs: Date.now() - started, ...record })}\n`);
function regular(filename) {
  assert.ok(!relative(repository, filename).split('/').includes('AGENTS.md'), 'AGENTS name rejected before content');
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size <= 167772160);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
}
function git(...args) {
  assert.ok(Date.now() - started <= 900000);
  assert.ok(++state.childrenStarted <= 4096);
  state.childProcessesActive++;
  try {
    const bytes = execFileSync(actualGit, ['--no-optional-locks', ...args], { cwd: repository, timeout: 15000, maxBuffer: 33554432, env: { PATH: '/usr/bin:/bin', HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
    event({ kind: 'git-close', args, status: 0, bytes: bytes.length });
    return bytes;
  } catch (error) {
    event({ kind: 'git-close', args, status: error.status, signal: error.signal, error: error.message });
    throw error;
  } finally {
    state.childrenClosed++;
    state.childProcessesActive--;
    receipt();
  }
}
try {
  assert.equal(realpathSync(process.execPath), actualNode);
  assert.equal(hash(regular(actualNode)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  assert.equal(hash(regular(actualGit)), '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
  const manifestBytes = regular(join(directory, 'MANIFEST.json'));
  assert.equal(hash(manifestBytes), digest);
  const manifest = JSON.parse(manifestBytes);
  const names = [...manifest.files.map(record => record.path), 'MANIFEST.json'].sort();
  assert.deepEqual(readdirSync(directory).sort(), names, 'exact overlay namespace');
  for (const record of manifest.files) {
    assert.ok(!record.path.includes('/') && record.path !== 'AGENTS.md');
    const bytes = regular(join(directory, record.path));
    assert.equal(bytes.length, record.bytes);
    assert.equal(lstatSync(join(directory, record.path)).mode & 0o777, record.mode);
    assert.equal(hash(bytes), record.sha256);
  }
  const committed = git('ls-tree', '-r', '-z', commit, '--', relative(repository, directory)).toString().split('\0').filter(Boolean);
  assert.deepEqual(committed.map(line => line.split('\t')[1]).sort(), names.map(name => relative(repository, join(directory, name))).sort());
  for (const line of committed) {
    const [metadata, filename] = line.split('\t');
    const [mode, type, blob] = metadata.split(' ');
    assert.equal(mode, '100644'); assert.equal(type, 'blob');
    assert.deepEqual(git('cat-file', 'blob', blob), regular(join(repository, filename)));
  }
  const binding = JSON.parse(regular(join(directory, 'bindings.json')));
  assert.equal(binding.protectedFiles.length, 37);
  assert.equal(hash(regular(join(base, 'MANIFEST.json'))), binding.baseManifestSha256);
  for (const entry of binding.protectedFiles) {
    const bytes = regular(join(repository, entry.path));
    assert.equal(lstatSync(join(repository, entry.path)).mode & 0o777, 0o644);
    assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
    assert.equal(git('ls-tree', entry.commit, '--', entry.path).toString().trim(), `${entry.mode} ${entry.type} ${entry.gitBlob}\t${entry.path}`);
    assert.deepEqual(git('cat-file', 'blob', entry.gitBlob), bytes);
  }
  state.protected37Authenticated = true;
  state.overlayFilesAuthenticated = names.length;
  receipt();
  const { applyOverlay } = await import('./apply.mjs');
  const staging = join(work, 'overlay');
  mkdirSync(staging, { mode: 0o755 });
  for (const effective of manifest.effectiveModules) {
    const original = regular(join(base, effective.path));
    const originalRecord = binding.protectedFiles.find(entry => entry.path === relative(repository, join(base, effective.path)));
    assert.equal(hash(original), originalRecord.sha256, 'original helper hash before applying overlay');
    const bytes = Buffer.from(applyOverlay(effective.path, original.toString()));
    event({ kind: 'overlay-application', path: effective.path, originalSha256: hash(original), appliedSha256: hash(bytes), expectedSha256: effective.sha256, bytes: bytes.length });
    assert.equal(hash(bytes), effective.sha256, 'declared patched hash after applying overlay');
    assert.equal(bytes.length, effective.bytes);
    writeFileSync(join(staging, effective.path), bytes, { mode: effective.mode, flag: 'wx' });
  }
  const executor = await import(pathToFileURL(join(staging, 'executor.mjs')).href);
  state.handedToExecutor = true;
  state.finishedAt = new Date().toISOString();
  receipt();
  await executor.run({ commit, manifestSha256: digest, launcher: { started, childrenStarted: state.childrenStarted, childrenClosed: state.childrenClosed } });
} catch (error) {
  state.failure = { name: error.name, message: error.message, stack: error.stack };
  event({ kind: 'launcher-stop-no-retry', ...state.failure });
  if (!state.handedToExecutor) {
    rmSync(join(run, 'node_modules'), { recursive: true, force: true });
    state.scratchRemoved = !existsSync(join(run, 'node_modules'));
  }
  state.finishedAt = new Date().toISOString();
  receipt();
  console.error(JSON.stringify({ outcome: 'LAUNCH-STOP-no-retry', failure: state.failure.message, childrenStarted: state.childrenStarted, childrenClosed: state.childrenClosed }));
  process.exitCode = 1;
}
