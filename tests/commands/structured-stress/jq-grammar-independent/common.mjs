import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export { digest, sourceSnapshot, bytesResult } from '../jq-42-independent-review/common.mjs';

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, '../../../..');
export function addFile(path, text) {
  assert.ok(resolve(path).startsWith(`${directory}/`), 'owned paths only');
  assert.equal(existsSync(path), false, `never overwrite ${path}`);
  assert.ok(text.endsWith('\n'), 'patch-created text requires final newline');
  const patch = `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.slice(0, -1).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), text);
}
export function artifact(name, value) {
  assert.match(name, /^[a-z0-9][a-z0-9.-]*\.json$/u);
  addFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}
export function newTransports(vector) {
  const length = Buffer.from(vector.inputHex, 'hex').length;
  return ['whole', 'bytewise', ...(vector.allBoundaries ? Array.from({ length: length + 1 }, (_, index) => `split:${index}`) : [])];
}
