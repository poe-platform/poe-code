import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const root = '/Users/kjopek/Workspace/safe-bash';
export const owned = 'tests/commands/table-text-stress/shared-stdin-review';
export const work = '/tmp/safe-bash-comm-final-review-owned';
export const ready = '/tmp/safe-bash-comm-final-review.ready';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export function save(path, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const body = text.length ? text.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n') + '\n' : '';
  const result = spawnSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${body}*** End Patch\n`, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}
export function files(base, prefix = '') {
  const result = [];
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...files(base, path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
export const hashes = (base, paths) => Object.fromEntries([...paths].sort().map(path => [path, sha(readFileSync(join(base, path)))]));
export const drift = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(path => before[path] !== after[path]).map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
export function execute(name, args, cwd, env = {}, timeout = 180000) {
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, TSX_DISABLE_CACHE: '1', TMPDIR: join(work, 'runtime-temp'), ...env }, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '', combined = stdout + '\n' + stderr;
  save(join(work, `${name}.stdout`), stdout);
  save(join(work, `${name}.stderr`), stderr);
  const record = { name, executable: process.execPath, args, cwd, env, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutSha256: sha(stdout), stderrSha256: sha(stderr), pass: Number(combined.match(/^# pass (\d+)/m)?.[1] ?? 0), fail: Number(combined.match(/^# fail (\d+)/m)?.[1] ?? 0), skipped: Number(combined.match(/^# skipped (\d+)/m)?.[1] ?? 0), failures: [...combined.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]), loadError: /ERR_MODULE_NOT_FOUND|TransformError|SyntaxError|TSError/.test(combined) };
  save(join(work, `${name}.command.json`), record);
  console.log(JSON.stringify(record));
  return record;
}
export function gatedSnapshot() {
  assert.ok(existsSync(ready), 'Root READY required before final product execution');
  const snapshot = join(work, 'snapshot');
  assert.ok(statSync(snapshot).isDirectory());
  return snapshot;
}
