import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { rows, hosts, materialize } from './corpus.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const sourcePaths = commit => git(['ls-tree', '-r', '--name-only', commit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
const sourceManifest = commit => Object.fromEntries(sourcePaths(commit).map(path => { const bytes = git(['show', `${commit}:${path}`]); return [path, { sha256: sha256(bytes), blob: git(['rev-parse', `${commit}:${path}`]).toString().trim(), size: bytes.length }]; }));
const inputNames = ['corpus.mjs', 'product.mjs', 'run.mjs', 'README.md'];
const inputHashes = () => Object.fromEntries(inputNames.map(name => [name, sha256(readFileSync(resolve(owned, name)))]));
const toolsTree = directory => {
  const result = {};
  function walk(path) {
    for (const name of readdirSync(path).sort()) {
      const child = resolve(path, name);
      const stat = lstatSync(child);
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) result[relative(directory, child)] = sha256(readFileSync(child));
    }
  }
  walk(directory);
  return result;
};
const live = () => ({ head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--porcelain=v1']).toString(), index: git(['diff', '--cached', '--name-only']).toString(), sourceHashes: Object.fromEntries(sourcePaths('HEAD').map(path => [path, existsSync(resolve(root, path)) ? sha256(readFileSync(resolve(root, path))) : null])) });
const historicalPath = 'tests/shell-stress/env-split-holdout/native-aligned.json';
const expectedNative = json(resolve(root, historicalPath)).toolsBefore;
const nativePaths = {
  env: Object.keys(expectedNative).find(path => path.endsWith('/coreutils-9.7/src/env')),
  bash: Object.keys(expectedNative).find(path => path.includes('gnu-bash-5.3') && path.endsWith('/bin/bash')),
  appleEnv: '/usr/bin/env',
};
const authenticate = () => Object.fromEntries(Object.entries(nativePaths).map(([name, path]) => {
  if (!path || !existsSync(path)) return [name, { path, available: false, reason: 'authenticated historical binary absent' }];
  const actual = sha256(readFileSync(path));
  return [name, { path, realpath: realpathSync(path), sha256: actual, expected: expectedNative[path].sha256, available: actual === expectedNative[path].sha256, reason: actual === expectedNative[path].sha256 ? null : 'historical binary hash mismatch' }];
}));
const sealPath = resolve(owned, 'seal.json');
const mode = process.argv[2];
assert.equal(rows.length, 24);
assert.equal(hosts.length, 6);
assert.equal(new Set([...rows, ...hosts].map(row => row.id)).size, 30);

if (mode === 'seal') {
  assert.equal(existsSync(sealPath), false, 'seal is write-once');
  assert.equal(git(['status', '--porcelain=v1', '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString(), '', 'freeze must precede source patches');
  const commit = git(['rev-parse', 'HEAD']).toString().trim();
  const compilerRoot = realpathSync(resolve(root, 'node_modules/typescript'));
  const devRoot = realpathSync(resolve(root, 'node_modules'));
  await save(sealPath, { schema: 1, frozenAt: new Date().toISOString(), sourceCommit: commit, inputs: inputHashes(), source: sourceManifest(commit), liveAtFreeze: live(), caseCount: 30, partition: { shebang: 20, direct: 4, hosts: 6 }, historicalOracle: { path: historicalPath, sha256: sha256(readFileSync(resolve(root, historicalPath))) }, native: authenticate(), node: { path: process.execPath, version: process.version, sha256: sha256(readFileSync(process.execPath)) }, compiler: { root: compilerRoot, files: toolsTree(compilerRoot), devRoot, devFiles: toolsTree(devRoot) } });
  console.log(JSON.stringify({ frozen: 30, sealSha256: sha256(await readFile(sealPath)), sourceCommit: commit }));
  process.exit(0);
}

const seal = json(sealPath);
assert.deepEqual(inputHashes(), seal.inputs, 'sealed inputs changed');
assert.equal(sha256(readFileSync(resolve(root, historicalPath))), seal.historicalOracle.sha256);
if (mode === 'verify') {
  const name = process.argv[3];
  assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9-]*$/u);
  const output = resolve(owned, name);
  const manifest = json(resolve(output, 'manifest.json'));
  for (const [path, hash] of Object.entries(manifest.files)) assert.equal(sha256(readFileSync(resolve(output, path))), hash, path);
  const report = json(resolve(output, 'report.json'));
  assert.equal(report.sealSha256, sha256(readFileSync(sealPath)));
  assert.equal(report.records.length, 30);
  assert.deepEqual(report.records.map(row => row.id), [...rows, ...hosts].map(row => row.id));
  assert.ok(report.cleanup.scratchRemoved);
  assert.ok(report.cleanup.allGroupsAbsent);
  assert.ok(report.guards.sourceStable && report.guards.distStable && report.guards.inputsStable && report.guards.compilerStable && report.guards.nativeStable);
  assert.equal(report.records.filter(row => row.passed).length, report.counts.passed);
  for (const record of report.records) if (record.product?.parsed) {
    assert.equal(record.product.parsed.attempts.length, 0);
    for (const load of record.product.parsed.loads) assert.equal(load.sha256, report.distHashes[load.path]);
    assert.ok(record.product.parsed.loads.some(load => load.path === 'index.js'));
  }
  console.log(JSON.stringify({ verified: name, ...report.counts }));
  process.exit(0);
}
assert.equal(mode, 'capture', 'use seal, capture COMMIT NEW_NAME, or verify NAME');
const sourceCommit = git(['rev-parse', `${process.argv[3]}^{commit}`]).toString().trim();
const outputName = process.argv[4];
assert.match(outputName, /^[a-zA-Z0-9][a-zA-Z0-9-]*$/u);
const output = resolve(owned, outputName);
assert.equal(existsSync(output), false, 'refusing evidence overwrite');
await mkdir(output);
const scratch = await mkdtemp('/tmp/env-shebang-review-');
const archive = resolve(scratch, 'source');
const bin = resolve(scratch, 'bin');
const groups = [];
const recordProcesses = [];
const startedAt = new Date().toISOString();
const nativeBefore = authenticate();
const compilerBefore = toolsTree(seal.compiler.root);
assert.deepEqual(compilerBefore, seal.compiler.files);
assert.deepEqual(toolsTree(seal.compiler.devRoot), seal.compiler.devFiles);
assert.equal(sha256(readFileSync(process.execPath)), seal.node.sha256);
const report = { sourceCommit, startedAt, sealSha256: sha256(readFileSync(sealPath)), fixtureCommit: git(['log', '-1', '--format=%H', '--', relative(root, sealPath)]).toString().trim(), liveBefore: live(), nativeBefore, platform: { platform: platform(), release: release(), linuxKernelAvailable: platform() === 'linux', primary: 'GNU env on actual host with Linux single-optional-argument argv modeled explicitly; NOT Linux kernel capture', secondary: 'actual host kernel shebang execution, never selected as primary' }, records: [], processes: recordProcesses, node: seal.node, compiler: seal.compiler, guards: {}, cleanup: {} };

async function run(file, args, options = {}) {
  const invocation = { file, args, cwd: options.cwd ?? root, env: options.env ?? { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdinBase64: Buffer.from(options.stdin ?? '').toString('base64') };
  const child = spawn(file, args, { cwd: invocation.cwd, env: invocation.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (child.pid) groups.push(child.pid);
  let timeout = false;
  let overflow = false;
  let length = 0;
  let error;
  const stdout = [], stderr = [];
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
  const timer = setTimeout(() => { timeout = true; stop(); }, options.timeout ?? 12000);
  const collect = chunks => bytes => { length += bytes.length; if (length > 4 * 1024 * 1024) { overflow = true; stop(); } else chunks.push(Buffer.from(bytes)); };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.on('error', caught => { error = { code: caught.code, message: caught.message }; });
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.stdin ?? '');
  const result = await new Promise(resolveResult => child.on('close', (status, signal) => { clearTimeout(timer); resolveResult({ invocation, pid: child.pid, status, signal, timeout, overflow, error, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64') }); }));
  stop();
  recordProcesses.push({ pid: child.pid, status: result.status, signal: result.signal, timeout, overflow, file });
  return result;
}
async function resetFixture(row, path) {
  assert.ok(path.startsWith(`${scratch}/cases/`));
  await rm(path, { recursive: true, force: true });
  await mkdir(resolve(path, 'sub'), { recursive: true, mode: 0o755 });
  for (const [name, file] of Object.entries(row.files)) { await writeFile(resolve(path, name), file.text); await chmod(resolve(path, name), file.mode); }
}
function snapshot(directory, prefix = '') {
  const entries = [];
  for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    entries.push({ path: `${prefix}${name}`, type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', mode: stat.mode & 0o777, ...(stat.isFile() ? { base64: readFileSync(path).toString('base64') } : {}) });
    if (stat.isDirectory()) entries.push(...snapshot(path, `${prefix}${name}/`));
  }
  return entries;
}
function expectedEffects(row) {
  const files = structuredClone(row.files);
  files.effect.text = row.expected.effect;
  files['sub/effect'].text = row.subEffect ?? 'seed';
  return [...Object.entries(files).map(([path, file]) => ({ path, type: 'file', mode: file.mode, base64: Buffer.from(file.text).toString('base64') })), { path: 'sub', type: 'directory', mode: 0o755 }].sort((left, right) => left.path.localeCompare(right.path));
}
function evaluate(row, parsed) {
  if (!row.kind) return { passed: parsed?.hostPassed === true && parsed.attempts.length === 0 && parsed.disposed === true, fields: {} };
  if (!parsed?.result) return { passed: false, fields: { available: false } };
  const expected = row.expected;
  const fields = {
    status: parsed.result.status === expected.status,
    stdout: parsed.result.stdout === Buffer.from(expected.stdout).toString('base64'),
    stderr: expected.diagnostic ? new RegExp(expected.diagnostic, 'u').test(Buffer.from(parsed.result.stderr, 'base64').toString()) : parsed.result.stderr === '',
    effects: isDeepStrictEqual(parsed.effects, expectedEffects(row)),
    safety: parsed.attempts.length === 0 && parsed.disposed === true,
  };
  return { passed: Object.values(fields).every(Boolean), fields };
}
let initialArchive;
let distBefore;
try {
  await mkdir(archive);
  await mkdir(bin);
  report.source = sourceManifest(sourceCommit);
  const tar = git(['archive', '--format=tar', sourceCommit, ...sourcePaths(sourceCommit)]);
  report.archiveSha256 = sha256(tar);
  const tarPath = resolve(scratch, 'source.tar');
  await writeFile(tarPath, tar);
  execFileSync('/usr/bin/tar', ['-xf', tarPath, '-C', archive]);
  for (const [path, entry] of Object.entries(report.source)) {
    const bytes = await readFile(resolve(archive, path));
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.blob);
  }
  initialArchive = toolsTree(archive);
  await symlink(realpathSync(resolve(root, 'node_modules')), resolve(archive, 'node_modules'));
  report.build = await run(process.execPath, [resolve(seal.compiler.root, 'bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: archive, timeout: 60000 });
  assert.equal(report.build.status, 0, 'archive build failed');
  await rm(resolve(archive, 'node_modules'));
  const dist = resolve(archive, 'dist');
  distBefore = toolsTree(dist);
  report.distHashes = distBefore;
  if (nativeBefore.bash.available) {
    await symlink(nativeBefore.bash.path, resolve(bin, 'bash'));
    await symlink(nativeBefore.bash.path, resolve(bin, 'sh'));
  }
  report.versions = {};
  for (const name of ['env', 'bash']) if (nativeBefore[name].available) report.versions[name] = await run(nativeBefore[name].path, ['--version']);
  const fixtures = [];
  for (const input of rows) {
    const path = resolve(scratch, 'cases', input.id);
    const row = materialize(input, path, bin);
    const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', TOKEN: 'two words', DROP: 'parent', PWD: path };
    const record = { id: row.id, kind: row.kind, inputSha256: sha256(JSON.stringify(row)), input: row, env, oracle: null, kernel: null };
    fixtures.push({ row, path, env, record });
    if (nativeBefore.env.available && nativeBefore.bash.available && !row.native) {
      await resetFixture(row, path);
      const argv = row.kind === 'direct-env' ? row.argv : [row.header.slice('/usr/bin/env '.length), row.scriptPath, ...row.args];
      const execution = await run(nativeBefore.env.path, argv, { cwd: path, env, stdin: row.stdin });
      record.oracle = { profile: row.kind === 'direct-env' ? 'direct-GNU-env-literal-argv' : 'Linux-optional-argv-model-GNU-env-on-Darwin', ...execution, effects: snapshot(path) };
    } else record.oracle = { unavailable: true, reason: row.native ?? 'authenticated native tools unavailable' };
    if (row.kind === 'shebang') {
      if (platform() === 'darwin' && nativeBefore.appleEnv.available && nativeBefore.bash.available) {
        await resetFixture(row, path);
        record.kernel = { profile: 'actual-Darwin-kernel-Apple-env-GNU-Bash-PATH', ...await run(resolve(path, 'script'), row.args, { cwd: path, env, stdin: row.stdin }), effects: snapshot(path) };
      } else record.kernel = { unavailable: true, reason: 'authenticated Darwin kernel profile not available' };
    }
  }
  report.nativeFinishedAt = new Date().toISOString();
  await save(resolve(output, 'native.json'), fixtures.map(({ record }) => record));
  for (const input of hosts) {
    const path = resolve(scratch, 'cases', input.id);
    const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', TOKEN: 'two words', DROP: 'parent', PWD: path };
    fixtures.push({ row: input, path, env, record: { id: input.id, kind: 'host', inputSha256: sha256(JSON.stringify(input)), input, env, oracle: { unavailable: true, reason: 'virtual host contract, not native parity' } } });
  }
  for (const { row, path, env, record } of fixtures) {
    const requestPath = resolve(scratch, `${row.id}.json`);
    await save(requestPath, { row, root: path, env, dist, distHashes: distBefore });
    const execution = await run(process.execPath, [resolve(owned, 'product.mjs'), requestPath]);
    let parsed = null;
    try { parsed = JSON.parse(Buffer.from(execution.stdout, 'base64').toString()); } catch {}
    record.product = { ...execution, parsed };
    Object.assign(record, evaluate(row, parsed));
    if (execution.status !== 0 || execution.timeout || execution.overflow) record.passed = false;
    if (record.oracle && !record.oracle.unavailable && parsed?.result) {
      record.strictNative = ['status', 'stdout', 'stderr'].every(field => parsed.result[field] === record.oracle[field]) && isDeepStrictEqual(parsed.effects, record.oracle.effects) && !record.oracle.error && !record.oracle.timeout && !record.oracle.overflow;
      record.nativeFields = Object.fromEntries(['status', 'stdout', 'stderr'].map(field => [field, parsed.result[field] === record.oracle[field]]));
      record.nativeFields.effects = isDeepStrictEqual(parsed.effects, record.oracle.effects);
      record.oracleExpectation = evaluate(row, { result: record.oracle, effects: record.oracle.effects, attempts: [], disposed: true });
    }
    report.records.push(record);
  }
  report.guards.sourceStable = Object.entries(initialArchive).every(([path, hash]) => sha256(readFileSync(resolve(archive, path))) === hash);
  report.guards.distStable = isDeepStrictEqual(toolsTree(dist), distBefore);
} catch (error) {
  report.failure = { name: error.name, message: error.message, stack: error.stack };
} finally {
  for (const pid of groups) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
  await new Promise(resolveWait => setTimeout(resolveWait, 100));
  report.cleanup.groups = groups.map(pid => { try { process.kill(-pid, 0); return { pid, absent: false }; } catch (error) { return { pid, absent: error.code === 'ESRCH' }; } });
  report.cleanup.allGroupsAbsent = report.cleanup.groups.every(group => group.absent);
  await rm(scratch, { recursive: true, force: true });
  report.cleanup.scratch = scratch;
  report.cleanup.scratchRemoved = !existsSync(scratch);
  report.guards.inputsStable = isDeepStrictEqual(inputHashes(), seal.inputs);
  report.guards.compilerStable = isDeepStrictEqual(toolsTree(seal.compiler.root), compilerBefore) && isDeepStrictEqual(toolsTree(seal.compiler.devRoot), seal.compiler.devFiles);
  report.nativeAfter = authenticate();
  report.guards.nativeStable = isDeepStrictEqual(nativeBefore, report.nativeAfter);
  report.liveAfter = live();
  report.finishedAt = new Date().toISOString();
  report.counts = {
    planned: 30, actual: report.records.length, passed: report.records.filter(row => row.passed).length,
    failed: report.records.filter(row => !row.passed).length,
    structured: report.records.filter(row => row.product?.parsed).length,
    shebangPassed: report.records.filter(row => row.kind === 'shebang' && row.passed).length,
    directPassed: report.records.filter(row => row.kind === 'direct-env' && row.passed).length,
    hostPassed: report.records.filter(row => row.kind === 'host' && row.passed).length,
    nativeAvailable: report.records.filter(row => !row.oracle?.unavailable).length,
    strictNative: report.records.filter(row => row.strictNative).length,
    timeouts: recordProcesses.filter(row => row.timeout).length,
    overflows: recordProcesses.filter(row => row.overflow).length,
  };
  await save(resolve(output, 'report.json'), report);
  await save(resolve(output, 'manifest.json'), { files: toolsTree(output) });
}
console.log(JSON.stringify({ output: outputName, ...report.counts, failure: report.failure ?? null, cleanup: report.cleanup.allGroupsAbsent && report.cleanup.scratchRemoved }));
if (report.failure || report.records.length !== 30 || !Object.values(report.guards).every(Boolean) || !report.cleanup.allGroupsAbsent) process.exitCode = 1;
