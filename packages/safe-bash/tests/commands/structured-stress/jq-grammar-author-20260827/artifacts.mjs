import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { digest, root } from '../jq-42-independent-review/common.mjs';

export function artifact(name, value, raw = false) {
  assert.match(name, /^[a-z0-9][a-z0-9./-]*$/iu);
  assert.ok(!name.includes('..'));
  const path = new URL(name, import.meta.url).pathname;
  assert.equal(existsSync(path), false, `immutable artifact: ${path}`);
  const text = raw ? value : `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return digest(readFileSync(path));
}
