import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const owned = 'tests/commands/structured-stress/jq-grammar-canonical-plan';
export const stress = 'tests/commands/structured-stress';
export const author = `${stress}/jq-grammar-author-20260827`;
export const review = `${stress}/jq-grammar-proposal-review`;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = path => readFileSync(resolve(root, path), 'utf8');
export const json = path => JSON.parse(read(path));
export function artifact(name, value) {
  const path = `${owned}/${name}`;
  assert.ok(!name.includes('..') && !existsSync(resolve(root, path)), `new owned path required: ${path}`);
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  assert.ok(text.endsWith('\n'));
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.slice(0, -1).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(path), text);
}
export function tree(path) {
  const entries = {};
  function visit(current) {
    const stat = lstatSync(resolve(root, current));
    assert.ok(!stat.isSymbolicLink(), `unexpected symlink: ${current}`);
    entries[relative(path, current) || '.'] = stat.isDirectory()
      ? { kind: 'directory', mode: stat.mode & 0o777 }
      : { kind: 'file', size: stat.size, mode: stat.mode & 0o777, sha256: digest(readFileSync(resolve(root, current))) };
    if (stat.isDirectory()) for (const name of readdirSync(resolve(root, current)).sort()) visit(`${current}/${name}`);
  }
  visit(path);
  return { path, namespaceAndContentSha256: digest(JSON.stringify(entries)), entries };
}
export const key = ({ argv, inputHex, files = {} }) => JSON.stringify([argv, inputHex, Object.entries(files).sort(([left], [right]) => left.localeCompare(right))]);
