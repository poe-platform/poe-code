import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export { runChild } from '../current-shell/support.mjs';
export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const primary = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
export const env = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
export function save(name, value) {
  if (!/^[\w.-]+$/.test(name)) throw Error('Invalid owned evidence name');
  const path = relative(root, resolve(owned, name)); if (existsSync(resolve(root, path))) throw Error(`Immutable evidence: ${path}`);
  const text = JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 8e6 });
}
export async function inventory() {
  const files = {};
  async function visit(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const path = `${directory}/${entry.name}`; if (entry.isDirectory()) await visit(path); else if (/\.(?:[cm]?ts|tsx|mjs|json)$/u.test(path)) files[path] = sha256(await readFile(path)); } }
  await visit('src'); await visit('tests/shell-stress');
  for (const path of ['tests/shell/diagnostic-limits.json', 'benchmarks/shell-stress/diagnostic-profiles/native-baseline.json', 'package.json', 'package-lock.json']) files[path] = sha256(await readFile(path));
  return Object.fromEntries(Object.entries(files).sort());
}
