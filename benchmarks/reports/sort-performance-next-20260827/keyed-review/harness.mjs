import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = fileURLToPath(new URL('.', import.meta.url));
export const repo = '/Users/kjopek/Workspace/safe-bash';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (commit, path) => execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
export const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function inventory(root, { skipDevLink = false } = {}) {
  const rows = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) { assert.ok(skipDevLink && child === join(root, 'node_modules') && realpathSync(child) === join(repo, 'node_modules'), child); continue; }
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) rows.push({ path: relative(root, child), sha256: hash(readFileSync(child)) });
    }
  };
  walk(root);
  return rows;
}
export async function childRun(root, args, destination, environment = {}) {
  const child = spawn(process.execPath, ['--max-old-space-size=512', ...args], { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = [];
  let bytes = 0, killed;
  const collect = target => chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { killed = 'output-cap'; child.kill('SIGKILL'); } else target.push(chunk); };
  child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
  const timer = setTimeout(() => { killed = 'watchdog'; child.kill('SIGKILL'); }, 180000);
  const closed = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  writeFileSync(destination + '.tap.txt', Buffer.concat(output), { flag: 'wx' });
  writeFileSync(destination + '.stderr.txt', Buffer.concat(errors), { flag: 'wx' });
  const text = Buffer.concat(output).toString();
  const result = { args, pid: child.pid, ...closed, killed: killed ?? null, exactChildClosed: true, outputBytes: bytes, passed: Number(/^# pass (\d+)$/mu.exec(text)?.[1] ?? 0), failed: Number(/^# fail (\d+)$/mu.exec(text)?.[1] ?? 0), skipped: Number(/^# skipped (\d+)$/mu.exec(text)?.[1] ?? 0) };
  json(destination + '.child.json', result);
  return result;
}
export function prepare(commit, label) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const root = realpathSync(mkdtempSync(`/tmp/sort-key-review-${label}-`));
  const build = join(root, 'build'); mkdirSync(build);
  const archive = execFileSync('git', ['archive', commit, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], { cwd: repo, maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  writeFileSync(join(root, 'source.tar'), archive);
  execFileSync('tar', ['-xf', join(root, 'source.tar'), '-C', build]);
  const sourceBefore = inventory(build);
  symlinkSync(join(repo, 'node_modules'), join(build, 'node_modules'), 'dir');
  const compiler = join(repo, 'node_modules/typescript/bin/tsc');
  execFileSync(process.execPath, ['--max-old-space-size=512', compiler, '-p', 'tsconfig.build.json'], { cwd: build, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const buildBefore = inventory(join(build, 'dist'));
  const packOutput = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: build, timeout: 180000, maxBuffer: 8 * 1024 * 1024 }).toString();
  const pack = JSON.parse(packOutput)[0];
  const staging = join(root, 'staging'); mkdirSync(staging);
  execFileSync('tar', ['-xf', join(root, pack.filename), '-C', staging]);
  const consumer = join(root, 'consumer'); mkdirSync(join(consumer, 'node_modules'), { recursive: true });
  renameSync(join(staging, 'package'), join(consumer, 'node_modules/virtual-bash'));
  const packageBefore = inventory(join(consumer, 'node_modules/virtual-bash'));
  const manifest = { commit, root, build, consumer, archiveSha256: hash(archive), sourceBefore, buildBefore, packageBefore, tarballSha256: hash(readFileSync(join(root, pack.filename))), pack: { filename: pack.filename, integrity: pack.integrity }, toolchain: { node: process.version, compilerSha256: hash(readFileSync(compiler)), compilerRuntimeSha256: hash(readFileSync(join(repo, 'node_modules/typescript/lib/_tsc.js'))) } };
  json(join(root, 'prepared.json'), manifest);
  return manifest;
}
export function authenticate(prepared) {
  const sourceAfter = inventory(prepared.build, { skipDevLink: true }).filter(file => !file.path.startsWith('dist/'));
  assert.deepEqual(sourceAfter, prepared.sourceBefore);
  assert.deepEqual(inventory(join(prepared.build, 'dist')), prepared.buildBefore);
  assert.deepEqual(inventory(join(prepared.consumer, 'node_modules/virtual-bash')), prepared.packageBefore);
  assert.equal(hash(readFileSync(join(prepared.root, 'source.tar'))), prepared.archiveSha256);
  assert.equal(hash(readFileSync(join(prepared.root, prepared.pack.filename))), prepared.tarballSha256);
  return { sourceBuildAndMovedPackageUnchanged: true, detectsAddedEntries: true, rejectsUnexpectedSymlinks: true, archiveSha256After: hash(readFileSync(join(prepared.root, 'source.tar'))), tarballSha256After: hash(readFileSync(join(prepared.root, prepared.pack.filename))) };
}
export function consumerCopy(prepared, label) {
  const root = join(prepared.root, label); mkdirSync(root);
  cpSync(join(prepared.consumer, 'node_modules'), join(root, 'node_modules'), { recursive: true, errorOnExist: true });
  return root;
}
