import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export { runChild, sha256 } from '../current-shell/support.mjs';
export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export function save(name, value) {
  assert.match(name, /^[a-z0-9-]+\.json$/u);
  assert.equal(existsSync(resolve(owned, name)), false);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, resolve(owned, name))}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 64 * 1024 * 1024 });
}
export async function snapshot(directory) {
  const entries = {};
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      const path = resolve(current, name), key = relative(directory, path), stat = await lstat(path), mode = stat.mode & 0o7777;
      if (stat.isDirectory()) { entries[key] = { type: 'directory', mode }; await visit(path); }
      else if (stat.isSymbolicLink()) entries[key] = { type: 'symlink', mode, link: await readlink(path) };
      else { assert.ok(stat.isFile()); entries[key] = { type: 'file', mode, base64: (await readFile(path)).toString('base64') }; }
    }
  }
  await visit(directory);
  return entries;
}
export function transport(result) { return result.status !== null && result.signal === null && !result.timedOut && !result.overflow && !result.groupAlive; }
export function rendering(row, binary, cwd, virtual = false) {
  const role = row.role ?? 'bash';
  const source = row.source.replaceAll('{{bash}}', virtual ? 'bash' : binary.path).replaceAll('{{sh}}', virtual ? 'sh' : binary.shPath);
  const files = row.files.map(fixture => ({ ...fixture, ...(fixture.text === undefined ? {} : { text: fixture.text.replaceAll('{{bash}}', virtual ? '/bin/bash' : binary.path) }) }));
  let args = ['-c', source, row.commandName], stdin = Buffer.from(row.stdinHex, 'hex');
  if (row.entry === 'stdin') { args = ['-s']; stdin = Buffer.from(source); }
  if (row.entry === 'file') { args = ['entry.sh']; files.push({ path: 'entry.sh', text: source, mode: 0o644 }); }
  const locale = row.locale ?? 'C';
  const env = row.cohort === 'discovery' ? { PATH: '', HOME: cwd, LANG: locale, LC_ALL: locale, TZ: 'UTC' } : row.cohort === 'closure' ? { PATH: 'unused', HOME: '/nonexistent', LANG: locale, LC_ALL: locale, TZ: 'UTC' } : { PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, LANG: locale, LC_ALL: locale, TZ: 'UTC', ...row.env };
  return { role, source, args, stdinHex: stdin.toString('hex'), files, env, cwd };
}
