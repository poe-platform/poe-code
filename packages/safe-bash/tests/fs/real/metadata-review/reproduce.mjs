import assert from 'node:assert/strict';
import * as host from 'node:fs/promises';
import hostDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealFileSystem } from '../../../../src/fs/real/index.ts';
import { createChmodCommand } from '../../../../src/commands/metadata/chmod.ts';
import { MemoryFileSystem } from '../../../../src/fs/memory/index.ts';
import { toByteSource } from '../../../../src/contracts/index.ts';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../../..');
assert.equal(process.cwd(), repository);
const destination = resolve(process.argv[2] ?? join(owned, 'evidence.json'));
assert.equal(dirname(destination), owned);
await assert.rejects(host.stat(destination), { code: 'ENOENT' });
const historicalRoot = 'tests/commands/metadata-stress/runtime-review';
const originalPath = `${historicalRoot}/original141.json`;
const frozenPath = `${historicalRoot}/final/calibration.json`;
const original = JSON.parse(await host.readFile(originalPath, 'utf8'));
const frozen = JSON.parse(await host.readFile(frozenPath, 'utf8'));
const originalRows = original.groups['chmod-existing-special-bits'].failures;
assert.equal(originalRows.length, 6);
const oracleRoot = 'tests/commands/metadata-stress/.oracle/coreutils-9.7';
const oracle = resolve(oracleRoot, 'src/chmod');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = async path => hash(await host.readFile(path));
const inputs = new Set([
  process.execPath,
  'AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  originalPath, frozenPath, `${historicalRoot}/README.md`,
  'tests/commands/metadata-stress/oracle-evidence.json',
  `${oracleRoot}/src/chmod`, `${oracleRoot}/src/chmod.c`,
  `${oracleRoot}/lib/modechange.c`, `${oracleRoot}/lib/fchmodat.c`,
  `${oracleRoot}/lib/config.h`, `${oracleRoot}/lib/sys/stat.h`,
  relative(repository, fileURLToPath(import.meta.url)),
  relative(repository, join(owned, 'syscall-probe.c')),
  relative(repository, join(owned, 'trace-fchmodat.c')),
]);
async function imports(path) {
  if (inputs.has(path)) return;
  inputs.add(path);
  const text = await host.readFile(path, 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/gu)) {
    await imports(relative(repository, resolve(dirname(path), match[1].replace(/\.js$/u, '.ts'))));
  }
}
for (const path of ['src/fs/real/index.ts', 'src/fs/memory/index.ts', 'src/commands/metadata/chmod.ts', 'src/contracts/index.ts']) await imports(path);
async function tooling(path) {
  for (const entry of await host.readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await tooling(child);
    else if (entry.isFile()) inputs.add(child);
  }
}
for (const name of ['tsx', 'esbuild', '@esbuild/darwin-arm64']) await tooling(`node_modules/${name}`);
async function snapshot() {
  const files = {};
  for (const path of [...inputs].sort()) files[path] = await hashFile(path);
  return { head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), files, digest: hash(JSON.stringify(files)) };
}
const before = await snapshot();
const pins = JSON.parse(await host.readFile('tests/commands/metadata-stress/oracle-evidence.json', 'utf8'));
assert.equal(await hashFile(oracle), pins.binaries.chmod);
assert.equal(process.platform, 'darwin');
const savedMask = process.umask(0o027);
const report = {
  capturedAt: new Date().toISOString(), invocation: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  before, originalDistinctCases: 6, pairedRealCasesAreNotNewBugs: true,
  profile: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch,
    uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups: process.getgroups(), umask: process.umask().toString(8) },
  commands: [], rows: [], positiveControls: [],
};
function external(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, ...options });
  report.lastExternalCall = { argv: [command, ...args], cwd: options.cwd ?? repository, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { argv: [command, ...args], cwd: options.cwd ?? repository, status: result.status, stdout: result.stdout, stderr: result.stderr };
}
async function metadata(path) {
  const stat = await host.stat(path, { bigint: true });
  return Object.fromEntries(Object.entries(stat).filter(([, value]) => typeof value === 'bigint').map(([key, value]) => [key, value.toString()]).concat([
    ['permissionsOctal', (stat.mode & 0o7777n).toString(8)], ['type', stat.isDirectory() ? 'directory' : 'file'],
  ]));
}
function acl(path) {
  const result = external('/bin/ls', ['-lndeO@', path]);
  assert.equal(result.status, 0);
  assert.equal(/^\s+\d+: /mu.test(result.stdout), false);
  return result;
}
async function command(fs, name, mode) {
  const calls = [];
  const instrumented = new Proxy(fs, { get(target, key) {
    const method = Reflect.get(target, key);
    if (typeof method !== 'function') return method;
    return async (...args) => {
      calls.push({ method: String(key), args: args.map(argument => argument?.signal ? { signalAborted: argument.signal.aborted } : argument) });
      return method.apply(target, args);
    };
  } });
  const stdout = [], stderr = [];
  const args = ['--', mode, name];
  const result = await createChmodCommand({ umask: 0o027 }).execute({ command: 'chmod', args, fs: instrumented,
    cwd: '/work', env: {}, signal: new AbortController().signal, stdin: toByteSource(''),
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
  });
  return { argv: ['chmod', ...args], status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), calls };
}
async function api(operation) {
  try { await operation(); return { fulfilled: true, status: 0, stdout: '', stderr: '' }; }
  catch (error) { return { fulfilled: false, status: 1, stdout: '', stderr: '', error: { code: error.code, syscall: error.syscall, path: error.path, message: error.message } }; }
}
let fixture;
try {
  assert.deepEqual(report.profile.groups, frozen.process.groups);
  for (const key of ['uid', 'euid', 'gid', 'egid']) assert.equal(report.profile[key], frozen.process[key]);
  report.profile.kernel = external('/usr/bin/uname', ['-a']);
  report.profile.os = external('/usr/bin/sw_vers', []);
  report.profile.id = external('/usr/bin/id', []);
  report.profile.compiler = external('/usr/bin/clang', ['--version']);
  report.oracleVersion = external(oracle, ['--version']);
  assert.equal(report.oracleVersion.stdout.split('\n')[0], 'chmod (GNU coreutils) 9.7');
  fixture = await host.mkdtemp('/tmp/safe-bash-real-metadata-review-');
  report.fixture = fixture;
  const cwd = join(fixture, 'work');
  await host.mkdir(cwd);
  await host.writeFile(join(fixture, 'sentinel'), 'metadata-review-sentinel');
  await host.writeFile(join(cwd, 'file'), 'data');
  await host.mkdir(join(cwd, 'directory'));
  report.profile.parentAcl = acl(cwd);
  report.profile.filesystem = Object.fromEntries(Object.entries(await host.statfs(cwd, { bigint: true })).map(([key, value]) => [key, String(value)]));
  const helper = join(fixture, 'syscall-probe');
  const trace = join(fixture, 'trace-fchmodat.dylib');
  for (const args of [
    ['-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', join(owned, 'syscall-probe.c'), '-o', helper],
    ['-Wall', '-Wextra', '-Werror', '-dynamiclib', join(owned, 'trace-fchmodat.c'), '-o', trace],
  ]) {
    const result = external('/usr/bin/clang', args);
    report.commands.push(result);
    assert.equal(result.status, 0, result.stderr);
  }
  report.helperHashes = { helper: await hashFile(helper), trace: await hashFile(trace) };
  const real = await createRealFileSystem({ root: fixture });
  const memory = new MemoryFileSystem();
  await memory.mkdir('/work');
  await memory.writeFile('/work/file', Buffer.from('data'));
  await memory.mkdir('/work/directory');
  for (const [index, originalRow] of originalRows.entries()) {
    const path = join(cwd, originalRow.name);
    const initial = Number.parseInt(originalRow.initial, 8);
    const row = { id: `C${index + 1}`, original: originalRow, quartet: {}, directControls: {} };
    const run = async operation => {
      await host.chmod(path, initial);
      const beforeStat = await metadata(path);
      assert.equal(beforeStat.permissionsOctal, originalRow.initial);
      assert.equal(beforeStat.uid, '501');
      assert.equal(beforeStat.gid, '0');
      const beforeAcl = acl(path);
      const nodeChmodCalls = [];
      const originalChmod = hostDefault.promises.chmod;
      let result;
      try {
        hostDefault.promises.chmod = async (...args) => {
          nodeChmodCalls.push({ api: 'node:fs/promises.chmod', args });
          return originalChmod(...args);
        };
        syncBuiltinESMExports();
        result = await operation();
      } finally {
        hostDefault.promises.chmod = originalChmod;
        syncBuiltinESMExports();
      }
      return { before: beforeStat, beforeAcl, result, nodeChmodCalls, after: await metadata(path), afterAcl: acl(path) };
    };
    row.quartet.gnu = await run(() => external(oracle, ['--', originalRow.mode, originalRow.name], { cwd }));
    row.quartet.command = await run(() => command(real, originalRow.name, originalRow.mode));
    const calls = row.quartet.command.result.calls.filter(call => call.method === 'chmod');
    assert.equal(calls.length, 1);
    const parsedMode = calls[0].args[1];
    row.parsed = { mode: originalRow.mode, clauses: [{ who: 'u', operator: '-', permissions: 's' }, { who: 'g', operator: '=', permissions: 's' }, { who: 'o', operator: '-', permissions: 't' }], modeDecimal: parsedMode, modeOctal: parsedMode.toString(8) };
    assert.equal(parsedMode, 0o2707);
    row.quartet.node = await run(async () => ({ ...await api(() => host.chmod(path, parsedMode)), api: 'node:fs/promises.chmod', args: [path, parsedMode] }));
    row.quartet.real = await run(async () => ({ ...await api(() => real.chmod(`/work/${originalRow.name}`, parsedMode)), api: 'RealFileSystem.chmod', args: [`/work/${originalRow.name}`, parsedMode] }));
    for (const method of ['libc-chmod', 'kernel-chmod', 'fchmodat']) {
      row.directControls[method] = await run(() => external(helper, [method, path, parsedMode.toString(8)], { cwd }));
      row.directControls[method].syscall = JSON.parse(row.directControls[method].result.stdout);
    }
    row.directControls.gnuTrace = await run(() => external(oracle, ['--', originalRow.mode, originalRow.name], {
      cwd, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', DYLD_INSERT_LIBRARIES: trace },
    }));
    row.directControls.gnuTrace.events = row.directControls.gnuTrace.result.stderr.split('\n').filter(line => line.startsWith('METADATA_TRACE ')).map(line => JSON.parse(line.slice('METADATA_TRACE '.length)));
    assert.equal(row.directControls.gnuTrace.events.length, 1);
    assert.equal(row.directControls.gnuTrace.events[0].modeDecimal & 0o7777, parsedMode);
    assert.equal(row.directControls.gnuTrace.events[0].returnValue, -1);
    assert.equal(row.directControls.gnuTrace.events[0].errno, 1);
    await memory.chmod(`/work/${originalRow.name}`, initial);
    row.memory = { result: await command(memory, originalRow.name, originalRow.mode), after: (await memory.stat(`/work/${originalRow.name}`)).mode & 0o7777 };
    row.originalNativeReproduced = row.quartet.gnu.result.status === originalRow.nativeCode && row.quartet.gnu.after.permissionsOctal === originalRow.expectedMode;
    row.originalMemoryReproduced = row.memory.result.status === originalRow.actualCode && row.memory.after === Number.parseInt(originalRow.actualMode, 8);
    row.realCounterpartReproduced = row.quartet.command.result.status === 0 && row.quartet.command.after.permissionsOctal === '707';
    for (const method of ['kernel-chmod', 'fchmodat']) {
      assert.equal(row.directControls[method].syscall.errno, 1);
      assert.equal(row.directControls[method].after.permissionsOctal, originalRow.initial);
    }
    assert.equal(row.directControls['libc-chmod'].result.status, 0);
    assert.equal(row.directControls['libc-chmod'].after.permissionsOctal, '707');
    for (const layer of ['node', 'real', 'command']) {
      assert.equal(row.quartet[layer].result.status, 0);
      assert.equal(row.quartet[layer].after.permissionsOctal, '707');
      assert.equal(row.quartet[layer].nodeChmodCalls.length, 1);
      assert.equal(row.quartet[layer].nodeChmodCalls[0].args[1], parsedMode);
    }
    assert.ok(row.originalNativeReproduced && row.originalMemoryReproduced && row.realCounterpartReproduced);
    report.rows.push(row);
    await host.chmod(path, 0o700);
  }
  for (const name of ['file', 'directory']) {
    const path = join(cwd, name);
    for (const control of ['same-gid-without-sgid', 'member-gid-with-sgid']) {
      if (control === 'member-gid-with-sgid') await host.chown(path, process.getuid(), process.getgid());
      const mode = control === 'same-gid-without-sgid' ? '=0707' : 'u-s,g=s,o-t';
      const outcomes = {};
      for (const layer of ['gnu', 'node', 'real', 'command', 'kernel-chmod', 'fchmodat']) {
        await host.chmod(path, 0o777);
        const beforeStat = await metadata(path);
        const targetMode = control === 'same-gid-without-sgid' ? 0o707 : 0o2707;
        let result;
        if (layer === 'gnu') result = external(oracle, ['--', mode, name], { cwd });
        else if (layer === 'node') result = await api(() => host.chmod(path, targetMode));
        else if (layer === 'real') result = await api(() => real.chmod(`/work/${name}`, targetMode));
        else if (layer === 'command') result = await command(real, name, mode);
        else result = external(helper, [layer, path, targetMode.toString(8)], { cwd });
        outcomes[layer] = { before: beforeStat, result, after: await metadata(path), acl: acl(path) };
        assert.equal(result.status, 0);
        assert.equal(outcomes[layer].after.permissionsOctal, targetMode.toString(8));
      }
      report.positiveControls.push({ name, control, outcomes });
    }
    await host.chmod(path, 0o700);
  }
  assert.equal(await host.readFile(join(cwd, 'file'), 'utf8'), 'data');
  assert.equal(await host.readFile(join(fixture, 'sentinel'), 'utf8'), 'metadata-review-sentinel');
  report.contentsAndSentinelUnchanged = true;
  report.after = await snapshot();
  report.inputsStable = report.before.digest === report.after.digest;
  assert.equal(report.inputsStable, true, 'Actual loaded source/evidence inputs changed; do not claim a closed snapshot');
  report.summary = { originalDistinct: 6, originalNativeReproduced: report.rows.filter(row => row.originalNativeReproduced).length,
    originalMemoryReproduced: report.rows.filter(row => row.originalMemoryReproduced).length, sameSixRealCounterpartsReproduced: report.rows.filter(row => row.realCounterpartReproduced).length,
    positiveControlScenarios: report.positiveControls.length, positiveControlLayerObservations: report.positiveControls.length * 6,
    classification: 'Six original cases, one shared Darwin chmod compatibility-wrapper cause; no parser/calculation or status-verification cause demonstrated. GNU parity still fails, not waived.' };
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  process.umask(savedMask);
  if (fixture) {
    await host.rm(fixture, { recursive: true, force: true });
    report.ownedFixtureRemoved = await host.stat(fixture).then(() => false, error => error.code === 'ENOENT');
  }
  const content = JSON.stringify(report, null, 2) + '\n';
  const saved = spawnSync('apply_patch', [], { cwd: repository, encoding: 'utf8', maxBuffer: 1024 * 1024,
    input: `*** Begin Patch\n*** Add File: ${destination}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n` });
  assert.equal(saved.status, 0, saved.stderr);
  console.log(JSON.stringify({ destination, summary: report.summary, failure: report.failure, inputsStable: report.inputsStable, ownedFixtureRemoved: report.ownedFixtureRemoved }, null, 2));
}
