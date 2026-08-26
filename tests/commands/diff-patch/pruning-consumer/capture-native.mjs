import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const diff = '/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff';
const patch = '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch';
const identities = [];
for (const [path, sha256] of [[diff, 'f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9'], [patch, 'c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00']]) {
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), sha256);
  const version = spawnSync(path, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  identities.push({ path, sha256, version: version.stdout.split('\n')[0] });
}
const boundary = await realpath(await mkdtemp('/tmp/safe-bash-prune-consumer-native-'));
await writeFile(join(boundary, 'SENTINEL'), 'never prune this boundary\n');
assert.equal(process.platform, 'darwin', 'This pinned native syscall proof requires macOS');
const interposerSource = new URL('./native-interpose.c', import.meta.url);
const interposer = join(boundary, 'pruning-interpose.dylib');
const compile = spawnSync('/usr/bin/cc', ['-dynamiclib', '-Wall', '-Wextra', '-o', interposer, interposerSource.pathname], { encoding: 'utf8', timeout: 30_000 });
assert.ifError(compile.error);
assert.equal(compile.status, 0, compile.stderr);
async function namespace(root) {
  const entries = {};
  async function visit(relative) {
    const path = join(root, relative);
    let stat;
    try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    entries[relative || '.'] = stat.isDirectory() ? { type: 'directory', mode: stat.mode & 511 } : { type: 'file', hex: (await readFile(path)).toString('hex') };
    if (stat.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name);
  }
  await visit('');
  return entries;
}
const results = [];
for (const mode of ['empty', 'nonempty', 'permission', 'enoent', 'child', 'eacces', 'eio', 'control-empty', 'control-nonempty', 'control-permission']) {
  const root = join(boundary, mode);
  await mkdir(join(root, 'parent/leaf'), { recursive: true });
  await writeFile(join(root, 'parent/leaf/file'), 'old\n');
  await writeFile(join(root, 'sentinel'), 'root sentinel\n');
  if (mode.endsWith('nonempty')) await writeFile(join(root, 'parent/keep'), 'keep\n');
  if (mode.endsWith('permission')) await chmod(join(root, 'parent'), 0o555);
  const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: root, TMPDIR: root };
  const generated = spawnSync(diff, ['-u', '--label', 'parent/leaf/file', '--label', '/dev/null', 'parent/leaf/file', '/dev/null'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(generated.status, 1);
  const before = await namespace(root);
  const injected = ['enoent', 'child', 'eacces', 'eio'].includes(mode);
  const log = join(boundary, `${mode}.calls`);
  const result = spawnSync(patch, ['-p0', '--batch', '--no-backup-if-mismatch'], { cwd: root, env: { ...env, ...(!mode.startsWith('control-') ? { DYLD_INSERT_LIBRARIES: interposer, PRUNE_MODE: injected ? mode : '', PRUNE_LOG: log } : {}) }, input: generated.stdout, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'patching file parent/leaf/file\n');
  assert.equal(result.stderr, '');
  results.push({ mode, injected, diff: { status: generated.status, stdout: generated.stdout, stderr: generated.stderr }, patch: { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, before, after: await namespace(root), calls: mode.startsWith('control-') ? null : await readFile(log, 'utf8') });
  await chmod(join(root, 'parent'), 0o755).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
assert.equal(await readFile(join(boundary, 'SENTINEL'), 'utf8'), 'never prune this boundary\n');
for (const result of results) {
  const expected = ['.', 'sentinel'];
  if (!['empty', 'enoent', 'control-empty'].includes(result.mode)) expected.push('parent');
  if (['nonempty', 'control-nonempty'].includes(result.mode)) expected.push('parent/keep');
  if (['permission', 'control-permission', 'child', 'eacces', 'eio'].includes(result.mode)) expected.push('parent/leaf');
  if (result.mode === 'child') {
    expected.push('parent/leaf/concurrent');
    assert.equal(result.after['parent/leaf/concurrent'].hex, Buffer.from('survives\n').toString('hex'));
  }
  assert.deepEqual(Object.keys(result.after).sort(), expected.sort());
}
for (const mode of ['empty', 'nonempty', 'permission']) assert.deepEqual(results.find(result => result.mode === mode).after, results.find(result => result.mode === `control-${mode}`).after);
const sourceHashes = {};
for (const path of [new URL(import.meta.url), interposerSource, interposer, '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/util.c', '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/safe.c']) sourceHashes[String(path)] = createHash('sha256').update(await readFile(path)).digest('hex');
for (const identity of identities) assert.equal(createHash('sha256').update(await readFile(identity.path)).digest('hex'), identity.sha256);
console.log(JSON.stringify({ identities, sourceHashes, boundary, capturedAt: new Date().toISOString(), uid: process.getuid(), platform: process.platform, node: process.version, compile: { status: compile.status, stdout: compile.stdout, stderr: compile.stderr }, argv: ['-p0', '--batch', '--no-backup-if-mismatch'], env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, results }, null, 2));
