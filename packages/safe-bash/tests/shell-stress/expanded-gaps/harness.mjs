import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export { runChild, sha256, primary } from '../current-shell/support.mjs';
export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const env = { PATH: '/fixture/bin:/fixture/.roles', HOME: '/fixture', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
export function save(filename, value) {
  if (!/^[\w.-]+$/.test(filename)) throw new Error('Invalid evidence name');
  const path = relative(root, resolve(owned, filename));
  if (existsSync(resolve(root, path))) throw new Error(`Immutable evidence exists: ${path}`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 4e6 });
}
export async function sourceSnapshot() {
  const { sha256 } = await import('./harness.mjs');
  const files = {};
  async function visit(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) await visit(path); else if (path.endsWith('.ts')) files[relative(root, path)] = sha256(await readFile(path)); } }
  await visit(resolve(root, 'src'));
  return Object.fromEntries(Object.entries(files).sort());
}
