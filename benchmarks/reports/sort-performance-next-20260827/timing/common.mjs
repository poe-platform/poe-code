import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = fileURLToPath(new URL('.', import.meta.url));
export const repo = '/Users/kjopek/Workspace/safe-bash';
export const base = 'dce6e3824d6de6d03490a531cf2bc7d2d279bb8c';
export const revisions = { A: base, B: '08a26051438f5c6bdde100a4fe724dbb84f6fca4', C: 'b4fe4c7868b7ab7067599c6f5d10e99d143aea54' };
export const textHashes = { A: '08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d', B: 'dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc', C: '9a66dc0e320c62aad86d78da9c55580cf6910a537a47db8a330e5122f63a1895' };
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const command = (program, args, options = {}) => execFileSync(program, args, { cwd: repo, timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...options });
export const git = (...args) => command('/usr/bin/git', args);
export function inventory(root, skipDevLink = false) {
  const result = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) { assert.ok(skipDevLink && child === join(root, 'node_modules') && realpathSync(child) === join(repo, 'node_modules')); continue; }
      if (entry.isDirectory()) walk(child);
      else { assert.ok(entry.isFile()); result.push({ path: relative(root, child), bytes: readFileSync(child).length, sha256: hash(readFileSync(child)) }); }
    }
  };
  walk(root);
  return result;
}
