import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, root } from '../jq-42-independent-review/common.mjs';

export const directory = dirname(fileURLToPath(import.meta.url));
export function addText(name, text) {
  assert.match(name, /^[a-zA-Z0-9_.\/-]+$/u);
  assert.ok(!name.split('/').includes('..'));
  const target = join(directory, name);
  assert.equal(existsSync(target), false, `immutable final artifact: ${target}`);
  const patch = `*** Begin Patch\n*** Add File: ${relative(root, target)}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return digest(readFileSync(target));
}
export const artifact = (name, data) => addText(name, `${JSON.stringify(data, null, 2)}\n`);
