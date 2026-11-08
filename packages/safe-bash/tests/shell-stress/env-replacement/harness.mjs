import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export { runChild, sha256 } from '../current-shell/support.mjs';
import { sha256 } from '../current-shell/support.mjs';
export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const primary = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
export const env = { PATH: '/usr/bin:/bin', HOME: '/fixture', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
export function save(name, value) {
  if (!/^[\w.-]+$/u.test(name) || existsSync(resolve(owned, name))) throw new Error(`Invalid/existing evidence ${name}`);
  const text = JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, resolve(owned, name))}\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
}
export async function snapshot() {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (path.endsWith('.ts')) files[path] = sha256(await readFile(path));
    }
  }
  await walk('src');
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json']) files[path] = sha256(await readFile(path));
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}
export async function effects(directory) {
  const files = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === 'bin') continue;
      const full = `${path}/${entry.name}`; const key = relative(directory, full);
      if (entry.isDirectory()) { files[`${key}/`] = null; await walk(full); }
      else files[key] = (await readFile(full)).toString('base64');
    }
  }
  await walk(directory); return files;
}
