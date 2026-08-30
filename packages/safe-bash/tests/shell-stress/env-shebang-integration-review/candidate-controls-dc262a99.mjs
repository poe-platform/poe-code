import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const candidate = 'dc262a99da8910d082ce7051e811952639588209';
const output = resolve(owned, 'candidate-dc262a99-controls');
assert.equal(existsSync(output), false, 'new evidence only');
await mkdir(output);
const scratch = await mkdtemp('/tmp/env-shebang-review-controls-');
const archive = resolve(scratch, 'source');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
const report = { candidate, startedAt: new Date().toISOString(), scratch, processes: [], controls: {}, native: [], cleanup: {} };
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
  const selections = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/shell', 'tests/shell-stress/env-split-author'];
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
  const suites = {
    author: ['env-shebang.test.ts', 'env-shebang-host.test.ts'],
    core: ['env-split-native.test.ts', 'env-split-host.test.ts', 'env-split-limits.test.ts', 'env-replacement.test.ts', 'invoke.test.ts'],
    scripts: ['script-entrypoint.test.ts', 'invocation-modes.test.ts', 'errexit-host.test.ts', 'expanded-gaps-env-host.test.ts'],
  };
  for (const [name, files] of Object.entries(suites)) {
    const result = await run(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', ...files.map(file => `tests/shell/${file}`)]);
    report.controls[name] = result;
    await save(`${name}.tap`, Buffer.from(result.stdout, 'base64'));
    await save(`${name}.stderr`, Buffer.from(result.stderr, 'base64'));
    assert.equal(result.timeout || result.overflow, false);
  }
  const probe = await run(process.execPath, [resolve(owned, 'candidate-observe-dc262a99.mjs'), resolve(archive, 'dist/index.js')]);
  await save('original-assertion-observations.json', Buffer.from(probe.stdout, 'base64'));
  report.probe = probe;
  assert.equal(probe.status, 0, Buffer.from(probe.stderr, 'base64').toString());
  const candidateCapture = JSON.parse(readFileSync(resolve(owned, 'candidate-dc262a99/report.json')));
  report.nativeTools = candidateCapture.nativeBefore;
  for (const value of Object.values(report.nativeTools)) { assert.equal(value.available, true); assert.equal(hash(readFileSync(value.path)), value.sha256); }
  const bin = resolve(scratch, 'bin'); await mkdir(bin);
  await symlink(report.nativeTools.bash.path, resolve(bin, 'bash'));
  const variants = JSON.parse(Buffer.from(probe.stdout, 'base64')).originals;
  for (const variant of variants) {
    const directory = resolve(scratch, variant.id); await mkdir(directory);
    const script = resolve(directory, 'script'); await writeFile(script, variant.source); await chmod(script, 0o755);
    const args = [...(variant.optional === null ? [] : [variant.optional]), './script'];
    const native = await run(report.nativeTools.env.path, args, { cwd: directory, env: { PATH: bin, LC_ALL: 'C' }, timeout: variant.optional === null ? 300 : 3000 });
    report.native.push({ id: variant.id, profile: 'Linux single-optional argv model; actual GNU env 9.7/Bash 5.3 on Darwin; recursive re-entry uses actual Darwin kernel', sourceSha256: hash(variant.source), ...native, entries: tree(directory) });
    if (variant.optional !== null) assert.equal(native.timeout || native.overflow, false);
  }
  for (const value of Object.values(report.nativeTools)) assert.equal(hash(readFileSync(value.path)), value.sha256);
  checkInputs();
  assert.deepEqual(tree(resolve(archive, 'dist')), report.distBefore);
  assert.deepEqual(tree(frozen.compiler.root), report.compilerBefore);
  assert.deepEqual(tree(frozen.compiler.devRoot), report.devBefore);
  report.guards = { inputsStable: true, distStable: true, compilerStable: true, nativeStable: true };
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
  await save('manifest.json', { files: tree(output), runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), probeSha256: hash(readFileSync(resolve(owned, 'candidate-observe-dc262a99.mjs'))) });
}
console.log(JSON.stringify({ controls: Object.fromEntries(Object.entries(report.controls).map(([name, result]) => [name, result.status])), failure: report.failure, cleanup: report.cleanup }));
