import assert from 'node:assert/strict';
import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MemoryFileSystem } from '/Users/kjopek/Workspace/safe-bash/src/fs/memory/index.ts';
import { createRealFileSystem } from '/Users/kjopek/Workspace/safe-bash/src/fs/real/index.ts';
import { createMetadataCommands } from '/Users/kjopek/Workspace/safe-bash/src/commands/metadata/index.ts';
import { toByteSource } from '/Users/kjopek/Workspace/safe-bash/src/contracts/index.ts';

const repository = '/Users/kjopek/Workspace/safe-bash';
const oracleRoot = join(repository, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const evidence = JSON.parse(await host.readFile(join(repository, 'tests/commands/metadata-stress/oracle-evidence.json'), 'utf8'));
const fixture = await host.mkdtemp('/tmp/safe-bash-metadata-leaf-native-');
const sentinel = join(fixture, 'sentinel');
const sentinelBytes = Buffer.from([83, 65, 70, 69, 0, 255]);
await host.writeFile(sentinel, sentinelBytes);
await host.mkdir(join(fixture, 'work'));
const cwd = join(fixture, 'work');
const groups = {};
const calibrations = [];
let nativeExecutions = 0;
const record = (group, passed, details) => {
  groups[group] ??= { cases: 0, pass: 0, fail: 0, failures: [] };
  groups[group].cases++;
  groups[group][passed ? 'pass' : 'fail']++;
  if (!passed) groups[group].failures.push(details);
};
const oracle = (command, args, mask = 0o022) => {
  assert.ok(cwd.startsWith('/tmp/safe-bash-metadata-leaf-native-'));
  const result = spawnSync('/bin/bash', ['-c', 'umask "$1"; shift; exec "$@"', 'leaf-review', mask.toString(8), join(oracleRoot, 'src', command), ...args], { cwd, timeout: 2000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', TMPDIR: cwd } });
  nativeExecutions++;
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr.toString() };
};
const run = async (name, args, fs, options = {}) => {
  const stdout = [];
  const stderr = [];
  const command = createMetadataCommands(options).find(command => command.name === name);
  assert.ok(command);
  const result = await command.execute({ command: name, args, fs, cwd: '/work', env: { TMPDIR: '/work' }, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
  return { code: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
};
try {
  for (const command of ['chmod', 'stat', 'mktemp']) {
    const hash = createHash('sha256').update(await host.readFile(join(oracleRoot, 'src', command))).digest('hex');
    assert.equal(hash, evidence.binaries[command]);
    assert.equal(oracle(command, ['--version']).stdout.toString().split('\n')[0], `${command} (GNU coreutils) 9.7`);
  }
  const memory = new MemoryFileSystem();
  await memory.mkdir('/work');
  await memory.writeFile('/work/file', Buffer.from('data'));
  await host.writeFile(join(cwd, 'file'), 'data');
  const real = await createRealFileSystem({ root: fixture });
  const timeFormats = ['[%Y][%.0Y][%.1Y][%.2Y][%.3Y]', '[%+010.3Y][% 010.3Y][%-10.3Y]', '[%1.3Y][%2.3Y][%3.3Y][%4.3Y]', '[%#08.0Y][%+08Y]'];
  for (const milliseconds of [-16016, -4004, -2002, -1005, -1001, -999, -101, -11, -1, 0, 1, 11, 999, 1001, 1005, 16016]) {
    await host.utimes(join(cwd, 'file'), new Date(milliseconds), new Date(milliseconds));
    const measured = await real.stat('/work/file');
    const nativeStat = await host.stat(join(cwd, 'file'), { bigint: true });
    calibrations.push({ requestedMs: milliseconds, realMs: measured.mtimeMs, nativeNs: nativeStat.mtimeNs.toString() });
    await memory.utimes('/work/file', measured.atimeMs, measured.mtimeMs);
    for (const format of timeFormats) {
      const expected = oracle('stat', [`--printf=${format}`, 'file']);
      const actual = await run('stat', [`--printf=${format}`, 'file'], memory);
      record('epoch-real-metadata', expected.code === actual.code && expected.stdout.equals(actual.stdout), { milliseconds, measured: measured.mtimeMs, format, native: expected.stdout.toString(), actual: actual.stdout.toString(), nativeNs: nativeStat.mtimeNs.toString() });
    }
  }
  await host.mkdir(join(cwd, 'directory'));
  await memory.mkdir('/work/directory');
  for (const name of ['file', 'directory']) for (const initial of [0o6777, 0o2777, 0o1777]) for (const mode of ['755', '00755', '=755', 'u=rw,go=r', 'a=', 'u-s,g=s,o-t']) {
    await host.chmod(join(cwd, name), initial);
    const measuredInitial = (await host.stat(join(cwd, name))).mode & 0o7777;
    await memory.chmod(`/work/${name}`, measuredInitial);
    const expected = oracle('chmod', ['--', mode, name], 0o027);
    const actual = await run('chmod', ['--', mode, name], memory, { umask: 0o027 });
    const expectedMode = (await host.stat(join(cwd, name))).mode & 0o7777;
    const actualMode = (await memory.stat(`/work/${name}`)).mode & 0o7777;
    record('chmod-existing-special-bits', expected.code === actual.code && expectedMode === actualMode, { name, initial: measuredInitial.toString(8), mode, expectedMode: expectedMode.toString(8), actualMode: actualMode.toString(8), nativeCode: expected.code, actualCode: actual.code, nativeStderr: expected.stderr, actualStderr: actual.stderr });
    await host.chmod(join(cwd, name), measuredInitial);
    const actualReal = await run('chmod', ['--', mode, name], real, { umask: 0o027 });
    const actualRealMode = (await host.stat(join(cwd, name))).mode & 0o7777;
    record('chmod-real-special-bits', expected.code === actualReal.code && expectedMode === actualRealMode, { name, initial: measuredInitial.toString(8), mode, expectedMode: expectedMode.toString(8), actualMode: actualRealMode.toString(8), nativeCode: expected.code, actualCode: actualReal.code, nativeStderr: expected.stderr, actualStderr: actualReal.stderr });
  }
  for (const mask of [0o022, 0o077, 0o777]) for (const mode of ['=', '=rw', '-w', '+w', '=u', 'u=rw,g=u,o=g', 'a-x,a+X', 'u=rw+x,g+X']) {
    await host.chmod(join(cwd, 'file'), 0o777);
    await memory.chmod('/work/file', 0o777);
    const expected = oracle('chmod', ['--', mode, 'file'], mask);
    const actual = await run('chmod', ['--', mode, 'file'], memory, { umask: mask });
    const expectedMode = (await host.stat(join(cwd, 'file'))).mode & 0o7777;
    const actualMode = (await memory.stat('/work/file')).mode & 0o7777;
    record('chmod-umask', expected.code === actual.code && expectedMode === actualMode, { mask: mask.toString(8), mode, expectedMode: expectedMode.toString(8), actualMode: actualMode.toString(8), nativeCode: expected.code, actualCode: actual.code });
  }
  await host.chmod(join(cwd, 'file'), 0o751);
  await memory.chmod('/work/file', 0o751);
  for (const format of ['[%+08s][% 08a][%+08f]', '[%#.0s][%#8.0a][%#08.8f]', '[%.0n][%08.2n][%+8.2n]', '[%#010.8a][%-#12.8f]', '[%+8.3s][% 8.3a]']) {
    const expected = oracle('stat', [`--printf=${format}`, 'file']);
    const actual = await run('stat', [`--printf=${format}`, 'file'], real);
    record('stat-independent-flags', expected.code === actual.code && expected.stdout.equals(actual.stdout), { format, native: expected.stdout.toString(), actual: actual.stdout.toString() });
  }
  for (const args of [['-q', 'bad'], ['-q', '--suffix=oops', 'bad'], ['-q', '-p', 'absent', 'item.XXX'], ['-u', '-p', 'absent', 'item.XXX'], ['-d', 'dir.XXX'], ['--suffix=', 'item.XXX.ext'], ['--suffix=.log', 'item.XXX'], ['--', '-item.XXX']]) {
    const expected = oracle('mktemp', args, 0o277);
    const actual = await run('mktemp', args, memory, { umask: 0o277 });
    const details = { args, nativeCode: expected.code, actualCode: actual.code, nativeStderr: expected.stderr, actualStderr: actual.stderr };
    record('mktemp-status-quiet', expected.code === actual.code && Boolean(expected.stderr) === Boolean(actual.stderr), details);
    if (expected.code === 0 && actual.code === 0 && !args.includes('-u')) {
      const nativePath = expected.stdout.toString().trimEnd();
      const virtualPath = actual.stdout.toString().trimEnd();
      const expectedMode = (await host.stat(join(cwd, nativePath))).mode & 0o777;
      const actualMode = (await memory.stat(`/work/${virtualPath}`)).mode & 0o777;
      record('mktemp-private-modes', expectedMode === actualMode, { args, expectedMode, actualMode });
    }
  }
  await memory.chmod('/work/file', 0o644);
  const partial = await run('chmod', ['-f', '600', 'missing', 'file'], memory);
  record('chmod-partial-errors', partial.code === 1 && partial.stderr === '' && ((await memory.stat('/work/file')).mode & 0o777) === 0o600, partial);
  assert.deepEqual(await host.readFile(sentinel), sentinelBytes);
  assert.equal((await host.lstat(sentinel)).isFile(), true);
  console.log(JSON.stringify({ nativeExecutions, groups, calibrations, sentinel: 'unchanged', fixture }, null, 2));
  if (Object.values(groups).some(group => group.fail > 0)) process.exitCode = 1;
} finally {
  await host.chmod(join(cwd, 'directory'), 0o700).catch(() => {});
  await host.rm(fixture, { recursive: true, force: true });
}
