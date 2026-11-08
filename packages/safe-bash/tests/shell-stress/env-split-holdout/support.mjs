import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, lstat, readlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const helper = 'tests/shell-stress/current-shell/support.mjs';
const committedHelper = git(['show', `303d184:${helper}`]);
assert.deepEqual(await readFile(resolve(root, helper)), committedHelper);
export const helperProof = { path: helper, commit: '303d18449c6e01bae4f33dada2f2022f95a56d49', sha256: sha256(committedHelper) };
export const { runChild } = await import('../current-shell/support.mjs');
export function save(name, value) {
  assert.match(name, /^[a-z0-9-]+\.json$/u);
  const path = resolve(owned, name);
  assert.equal(existsSync(path), false);
  const text = JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 64 * 1024 * 1024 });
}
export const transport = result => result.status !== null && result.signal === null && !result.timedOut && !result.overflow && !result.groupAlive;
export async function snapshot(directory) {
  const entries = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name), stat = await lstat(path);
    entries[name] = { type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file', mode: stat.mode & 0o7777, ...(stat.isFile() ? { hex: (await readFile(path)).toString('hex') } : stat.isSymbolicLink() ? { target: await readlink(path) } : {}) };
    if (stat.isDirectory()) for (const [child, entry] of Object.entries(await snapshot(path))) entries[`${name}/${child}`] = entry;
  }
  return entries;
}
