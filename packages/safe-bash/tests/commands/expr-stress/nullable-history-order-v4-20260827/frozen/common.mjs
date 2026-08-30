import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(directory, '../../../../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = filename => JSON.parse(readFileSync(path.join(directory, filename)));
export const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' };
export const errorJSON = error => error ? { name: error.name, message: error.message, code: error.code ?? null, category: error.category ?? null } : null;
export function command(filename, argv, options = {}) {
  const result = spawnSync(filename, argv, { cwd: root, env, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536, ...options });
  return { filename, argv0: options.argv0 ?? filename, argv, environment: options.env ?? env, cwd: options.cwd ?? root, status: result.status, signal: result.signal, error: errorJSON(result.error), stdoutHex: (result.stdout ?? Buffer.alloc(0)).toString('hex'), stderrHex: (result.stderr ?? Buffer.alloc(0)).toString('hex') };
}
export function git(argv) {
  const result = spawnSync('/usr/bin/git', argv, { cwd: root, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
export function addFile(relative, text) {
  const absolute = path.resolve(root, relative);
  assert.ok(absolute.startsWith(`${directory}/`) || ['/tmp/expr-history-freeze-v4-20260827-candidate.txt', '/tmp/expr-history-freeze-v4-20260827-issue.txt'].includes(absolute));
  assert.ok(!existsSync(absolute), `immutable output already exists: ${absolute}`);
  const patch = `*** Begin Patch\n*** Add File: ${absolute}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [patch], { cwd: root, timeout: 20000, maxBuffer: 65536 });
  assert.equal(result.status, 0, String(result.stderr));
}
export const addJSON = (name, value) => addFile(path.relative(root, path.join(directory, name)), `${JSON.stringify(value, null, 2)}\n`);
export function inventory(folder, excluded = []) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(folder, entry.name);
    const relative = path.relative(folder, filename);
    assert.ok(!entry.isSymbolicLink(), filename);
    if (excluded.includes(relative)) return [];
    if (entry.isDirectory()) return [{ path: relative, kind: 'directory' }, ...inventory(filename).map(item => ({ ...item, path: `${relative}/${item.path}` }))];
    assert.ok(entry.isFile(), filename);
    const bytes = readFileSync(filename);
    return [{ path: relative, kind: 'file', bytes: bytes.length, sha256: hash(bytes) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}
