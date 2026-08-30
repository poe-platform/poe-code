import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { sha256 } from '../current-shell/support.mjs';
export { sha256 } from '../current-shell/support.mjs';
export const root = process.cwd();
export const owned = 'tests/shell-stress/kernel-reconciliation';
export const anchor = 'c116d637aa82e4b075460fc07088a5703a10e7b4';
export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export function save(name, value) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid evidence filename');
  const path = `${owned}/${name}`;
  if (existsSync(path)) throw new Error(`Immutable evidence exists: ${path}`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 4e6 });
}
export async function inventory() {
  const entries = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) await visit(path);
      else if (/\.(ts|mjs|js)$/.test(path)) entries[path] = sha256(await readFile(path));
    }
  }
  await visit('src');
  await visit('tests');
  for (const path of ['tests/shell-stress/expanded-gaps/native-frozen.json', 'tests/shell-stress/invocation-modes/native-corrected-evidence.json']) entries[path] = sha256(await readFile(path));
  return Object.fromEntries(Object.entries(entries).sort());
}
export async function sourceStamp() {
  const shell = {};
  for (const name of (await readdir('src/shell')).filter(name => name.endsWith('.ts')).sort()) {
    const path = `src/shell/${name}`;
    const actual = sha256(await readFile(path));
    const committed = sha256(execFileSync('git', ['show', `${anchor}:${path}`]));
    shell[path] = { actual, committed, matches: actual === committed };
  }
  return { timestamp: new Date().toISOString(), head: git('rev-parse', 'HEAD'), runtimeCommit: git('log', '-1', '--format=%H', '--', 'src/shell/runtime.ts'), shell, status: git('status', '--short'), staged: git('diff', '--cached', '--name-only'), valid: Object.values(shell).every(row => row.matches) };
}
export function alive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export const localPath = path => relative(root, resolve(path));
