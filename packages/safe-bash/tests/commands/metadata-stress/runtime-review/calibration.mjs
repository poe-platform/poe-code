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
const originalPath = process.env.METADATA_ORIGINAL ?? '/tmp/safe-bash-metadata-runtime-original141.json';
const original = JSON.parse(await host.readFile(originalPath, 'utf8'));
const output = process.env.METADATA_CALIBRATION_OUTPUT ?? '/tmp/safe-bash-metadata-runtime-calibration.json';
const oracleRoot = join(repository, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, content) => {
  const result = spawnSync('apply_patch', [], { cwd: repository, encoding: 'utf8', input: `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
};
const sourceHashes = async () => Object.fromEntries(await Promise.all(['chmod.ts', 'stat.ts', 'index.ts', 'internal.ts', 'mktemp.ts'].map(async name => [name, hash(await host.readFile(join(repository, 'src/commands/metadata', name)))])));
const beforeHashes = await sourceHashes();
const fixture = await host.mkdtemp('/tmp/safe-bash-metadata-runtime-calibration-');
const cwd = join(fixture, 'work');
const sentinelBytes = Buffer.from([83, 65, 70, 69, 0, 255]);
await host.writeFile(join(fixture, 'sentinel'), sentinelBytes);
await host.mkdir(cwd);
await host.writeFile(join(cwd, 'file'), 'data');
await host.mkdir(join(cwd, 'directory'));
const oldMask = process.umask(0o027);
const report = { capturedAt: new Date().toISOString(), sourceBefore: beforeHashes, originalSha256: hash(await host.readFile(originalPath)), fixture, process: { platform: process.platform, arch: process.arch, node: process.version, uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups: process.getgroups(), previousUmask: oldMask.toString(8), measuredUmask: process.umask().toString(8) }, nativeExecutions: 0, timestampRows: [], chmodRows: [] };
const native = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', TMPDIR: cwd }, ...options });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};
const oracle = (name, args) => {
  report.nativeExecutions++;
  return native('/bin/bash', ['-c', 'umask "$1"; shift; exec "$@"', 'bounded-metadata-review', '027', join(oracleRoot, 'src', name), ...args]);
};
const run = async (name, args, fs) => {
  const stdout = [];
  const stderr = [];
  const command = createMetadataCommands({ umask: 0o027 }).find(command => command.name === name);
  assert.ok(command);
  const result = await command.execute({ command: name, args, fs, cwd: '/work', env: { TMPDIR: '/work' }, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
  return { code: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
};
const rawNumber = value => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(value);
  return { value, decimal17: value.toPrecision(17), ieee754be: bytes.toString('hex') };
};
const metadata = async name => {
  const stat = await host.stat(join(cwd, name), { bigint: true });
  return { mode: (stat.mode & 0o7777n).toString(8), uid: stat.uid.toString(), gid: stat.gid.toString(), device: stat.dev.toString(), inode: stat.ino.toString(), mtimeNs: stat.mtimeNs.toString() };
};
const acl = name => native('/bin/ls', ['-ldeO@', join(cwd, name)]);
try {
  const evidence = JSON.parse(await host.readFile(join(repository, 'tests/commands/metadata-stress/oracle-evidence.json'), 'utf8'));
  report.oracle = { binaries: {}, versions: {} };
  for (const name of ['chmod', 'stat', 'mktemp']) {
    report.oracle.binaries[name] = hash(await host.readFile(join(oracleRoot, 'src', name)));
    assert.equal(report.oracle.binaries[name], evidence.binaries[name]);
    report.oracle.versions[name] = oracle(name, ['--version']);
    assert.equal(report.oracle.versions[name].stdout.split('\n')[0], `${name} (GNU coreutils) 9.7`);
  }
  report.process.id = native('/usr/bin/id', []);
  report.parentAcl = native('/bin/ls', ['-ldeO@', fixture, cwd]);
  const real = await createRealFileSystem({ root: fixture });
  const memory = new MemoryFileSystem();
  await memory.mkdir('/work');
  await memory.writeFile('/work/file', Buffer.from('data'));
  await memory.mkdir('/work/directory');
  for (const [index, row] of original.groups['epoch-real-metadata'].failures.entries()) {
    await host.utimes(join(cwd, 'file'), new Date(row.milliseconds), new Date(row.milliseconds));
    const realStat = await real.stat('/work/file');
    const nativeStat = await host.stat(join(cwd, 'file'), { bigint: true });
    await memory.utimes('/work/file', realStat.atimeMs, realStat.mtimeMs);
    const memoryStat = await memory.stat('/work/file');
    const deterministic = new Proxy(memory, { get(target, key) {
      if (key === 'stat' || key === 'lstat') return async (...args) => ({ ...await target[key](...args), mtimeMs: row.measured });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const expected = oracle('stat', [`--printf=${row.format}`, 'file']);
    const actualMemory = await run('stat', [`--printf=${row.format}`, 'file'], memory);
    const actualReal = await run('stat', [`--printf=${row.format}`, 'file'], real);
    const actualDeterministic = await run('stat', [`--printf=${row.format}`, 'file'], deterministic);
    const sourceCause = row.format.includes('%1.3Y') ? (row.measured < -1000 ? 'negative fractional conversion; narrow-width also present where raw native fields have trailing spaces' : 'narrow-width trailing spaces') : 'negative fractional conversion';
    report.timestampRows.push({ id: `T${String(index + 1).padStart(2, '0')}`, original: row, requestedMs: row.milliseconds, rawVfsMtimeMs: rawNumber(memoryStat.mtimeMs), rawRealMtimeMs: rawNumber(realStat.mtimeMs), deterministicMtimeMs: rawNumber(row.measured), nativeNs: nativeStat.mtimeNs.toString(), nativeMs: rawNumber(Number(nativeStat.mtimeNs) / 1e6), nativeSubMillisecondNs: (nativeStat.mtimeNs % 1000000n).toString(), nativeSubMicrosecondNs: (nativeStat.mtimeNs % 1000n).toString(), observedInputGranularity: 'The existing Date/utimes controls include microsecond-aligned timestamps, sometimes 1000ns toward zero from the requested integer ms; this does not establish filesystem timestamp resolution.', sameOriginalNativeNs: nativeStat.mtimeNs.toString() === row.nativeNs, sameOriginalVfsMs: memoryStat.mtimeMs === row.measured, sameVfsVsNativeMs: memoryStat.mtimeMs === Number(nativeStat.mtimeNs) / 1e6, originalNativeReproduced: expected.stdout === row.native && expected.code === 0, classification: 'semantic', calibrationOnly: false, cause: sourceCause, expected, actualMemory, actualReal, actualDeterministic, memoryEqual: expected.code === actualMemory.code && expected.stdout === actualMemory.stdout, realEqual: expected.code === actualReal.code && expected.stdout === actualReal.stdout, deterministicEqual: expected.code === actualDeterministic.code && expected.stdout === actualDeterministic.stdout });
  }
  for (const [index, row] of original.groups['chmod-existing-special-bits'].failures.entries()) {
    const initial = Number.parseInt(row.initial, 8);
    const requestedOriginalInitial = [0o6777, 0o2777, 0o1777][index % 3];
    const path = join(cwd, row.name);
    await host.chmod(path, requestedOriginalInitial);
    const initialSetup = await metadata(row.name);
    const initialAcl = acl(row.name);
    const expected = oracle('chmod', ['--', row.mode, row.name]);
    const nativeResult = await metadata(row.name);
    await host.chmod(path, initial);
    const realInitial = await metadata(row.name);
    const realCalls = [];
    const instrumentedReal = new Proxy(real, { get(target, key) {
      if (key === 'chmod') return async (path, mode, options) => { realCalls.push({ path, targetMode: mode.toString(8) }); return target.chmod(path, mode, options); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const actualReal = await run('chmod', ['--', row.mode, row.name], instrumentedReal);
    const realResult = await metadata(row.name);
    await memory.chmod(`/work/${row.name}`, initial);
    const memoryInitial = ((await memory.stat(`/work/${row.name}`)).mode & 0o7777).toString(8);
    const actualMemory = await run('chmod', ['--', row.mode, row.name], memory);
    const memoryResult = ((await memory.stat(`/work/${row.name}`)).mode & 0o7777).toString(8);
    assert.equal(realCalls.length, 1);
    const targetMode = Number.parseInt(realCalls[0].targetMode, 8);
    await host.chmod(path, initial);
    const nodeInitial = await metadata(row.name);
    let directNode;
    try { await host.chmod(path, targetMode); directNode = { fulfilled: true }; }
    catch (error) { directNode = { fulfilled: false, code: error.code, message: error.message, syscall: error.syscall }; }
    const nodeResult = await metadata(row.name);
    await host.chmod(path, initial);
    const apiInitial = await metadata(row.name);
    let realApi;
    try { await real.chmod(`/work/${row.name}`, targetMode); realApi = { fulfilled: true }; }
    catch (error) { realApi = { fulfilled: false, code: error.code, message: error.message }; }
    const apiResult = await metadata(row.name);
    report.chmodRows.push({ id: `C${index + 1}`, original: row, requestedOriginalInitial: requestedOriginalInitial.toString(8), initialSetup, initialAcl, targetMode: targetMode.toString(8), expected, nativeResult, realInitial, realCalls, actualReal, realResult, memoryInitial, actualMemory, memoryResult, nodeInitial, directNode, nodeResult, apiInitial, realApi, apiResult, finalAcl: acl(row.name), originalNativeReproduced: expected.code === row.nativeCode && nativeResult.mode === row.expectedMode, originalMemoryReproduced: actualMemory.code === row.actualCode && memoryResult === row.actualMode, classification: 'host syscall/status-effect divergence; concrete RealFS/native parity concern, not a demonstrated symbolic parser defect or waived EPERM', routing: 'Poincare/root: GNU9.7 chmod uses fchmodat; RealFS calls Node fs.promises.chmod. Direct Node and RealFS behavior captured separately. No FS source edits authorized.' });
    await host.chmod(path, 0o700);
  }
  assert.deepEqual(await host.readFile(join(fixture, 'sentinel')), sentinelBytes);
  assert.equal((await host.lstat(join(fixture, 'sentinel'))).isFile(), true);
  assert.equal(await host.readFile(join(cwd, 'file'), 'utf8'), 'data');
  report.sentinel = 'unchanged';
  report.sourceAfter = await sourceHashes();
  report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.timestampSummary = { originalDifferentRows: 30, semantic: 30, calibrationOnly: 0, controls: 90, memoryEqual: report.timestampRows.filter(row => row.memoryEqual).length, realEqual: report.timestampRows.filter(row => row.realEqual).length, deterministicEqual: report.timestampRows.filter(row => row.deterministicEqual).length, originalNativeReproduced: report.timestampRows.filter(row => row.originalNativeReproduced).length, sameOriginalVfsMs: report.timestampRows.filter(row => row.sameOriginalVfsMs).length };
} finally {
  process.umask(oldMask);
  assert.deepEqual(await host.readFile(join(fixture, 'sentinel')), sentinelBytes);
  await host.rm(fixture, { recursive: true, force: true });
  report.fixtureRemoved = await host.lstat(fixture).then(() => false, error => error.code === 'ENOENT');
  save(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, sourceStable: report.sourceStable, timestampSummary: report.timestampSummary, chmodRows: report.chmodRows.length, nativeExecutions: report.nativeExecutions, fixtureRemoved: report.fixtureRemoved }, null, 2));
