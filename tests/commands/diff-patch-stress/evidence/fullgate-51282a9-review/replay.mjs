import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = process.cwd();
export const base = 'tests/commands/diff-patch-stress/evidence/fullgate-51282a9-review';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
export function save(path, value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  assert(!existsSync(path), `Refusing to replace evidence: ${path}`);
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 32 * 1024 * 1024 });
}
export function snapshot(revision, label) {
  const directory = resolve(base, '.scratch', label);
  assert(!existsSync(directory));
  mkdirSync(directory, { recursive: true });
  const archive = git('archive', revision, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/diff-patch-stress', 'tests/commands/metadata-stress', 'tests/commands/metadata', 'tests/commands/table-text-stress', 'tests/commands/table-text');
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', directory], { input: archive, maxBuffer: 256 * 1024 * 1024 });
  symlinkSync(resolve('node_modules'), resolve(directory, 'node_modules'));
  return directory;
}
export function qualify(directory) {
  symlinkSync(resolve('tests/commands/metadata-stress/.oracle'), resolve(directory, 'tests/commands/metadata-stress/.oracle'));
}
export function originalReplay(directory, label) {
  const freeze = JSON.parse(readFileSync(`${base}/initial-freeze.json`, 'utf8'));
  const pattern = `^(?:${freeze.failures.map(row => row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
  const args = ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-name-pattern', pattern, ...freeze.targets];
  const result = spawnSync(process.execPath, args, { cwd: directory, env: { ...process.env, TMPDIR: resolve(base, '.scratch') }, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const summary = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  save(`${base}/${label}.json`, { capturedAt: new Date().toISOString(), directory, executable: process.execPath, args, status: result.status, signal: result.signal, error: result.error?.message, summary, stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr) });
  save(`${base}/${label}.tap.txt`, result.stdout);
  save(`${base}/${label}.stderr.txt`, result.stderr);
  console.log(label, result.status, summary);
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2] === 'initial') {
  const directory = snapshot('72f780d', 'initial');
  originalReplay(directory, 'initial-cold-original31');
  qualify(directory);
  originalReplay(directory, 'initial-qualified-original31');
}
