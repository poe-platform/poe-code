import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, symlinkSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const review = dirname(fileURLToPath(import.meta.url));
export const root = resolve(review, '../../../../..');
export const fixture = 'tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl';
export const canonical = `${fixture}/direct-curl.test.ts`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
export function save(name, value) {
  const path = join(review, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function archive(revision, name) {
  const destination = join(review, '.scratch', name);
  mkdirSync(destination, { recursive: true });
  assert.deepEqual(readdirSync(destination), []);
  const archivePath = `${destination}.tar.gz`;
  git('archive', '--format=tar.gz', `--output=${archivePath}`, revision);
  execFileSync('tar', ['-x', '-f', archivePath, '-C', destination], { maxBuffer: 1024 * 1024 });
  symlinkSync(join(root, 'node_modules'), join(destination, 'node_modules'), 'dir');
  return destination;
}
export function census(directory, paths) {
  return paths.map(path => {
    const actual = join(directory, path);
    const stat = lstatSync(actual);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(actual)) : readFileSync(actual);
    return { path, type: stat.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: sha256(bytes) };
  });
}
export function treePaths(revision, prefix = 'tests') {
  return git('ls-tree', '-r', '--name-only', '-z', revision, '--', prefix).toString().split('\0').filter(Boolean);
}
export function differences(before, after) {
  return before.flatMap((row, index) => JSON.stringify(row) === JSON.stringify(after[index]) ? [] : [{ path: row.path, before: row, after: after[index] }]);
}
export async function run(directory, args, label, environment = {}) {
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', ...args], { cwd: directory, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  let timedOut = false;
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 45_000);
  const status = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveResult({ code, signal }));
  }).finally(() => clearTimeout(timer));
  const report = { command: [process.execPath, '--unhandled-rejections=strict', ...args], cwd: directory, environmentOverrides: environment, pid: child.pid, startedAt, finishedAt: new Date().toISOString(), ...status, timedOut, childClosed: true, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  save(`execution/${label}.json`, report);
  return report;
}
