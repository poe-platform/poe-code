import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, lstat, readlink } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
export { runChild, sha256 } from '../current-shell/support.mjs';
export const owned = 'tests/shell-stress/errexit-consumer';
export const primary = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
export const environment = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
export function save(name, value) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid immutable artifact name');
  const path = `${owned}/${name}`;
  if (existsSync(path)) throw new Error(`Immutable artifact already exists: ${path}`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 4e6 });
}
export async function entries(directory, ignore = []) {
  const result = {};
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      if (current === directory && ignore.includes(name)) continue;
      const path = resolve(current, name);
      const key = relative(directory, path);
      const stat = await lstat(path);
      if (stat.isDirectory()) { result[key + '/'] = { mode: stat.mode & 0o777 }; await visit(path); }
      else if (stat.isSymbolicLink()) result[key] = { link: await readlink(path) };
      else result[key] = { hex: (await readFile(path)).toString('hex'), mode: stat.mode & 0o777 };
    }
  }
  await visit(directory);
  return result;
}
