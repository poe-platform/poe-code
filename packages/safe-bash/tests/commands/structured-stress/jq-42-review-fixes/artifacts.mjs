import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from '../jq-42-independent-review/common.mjs';

export function artifact(name, document) {
  assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u);
  const path = fileURLToPath(new URL(name, import.meta.url));
  assert.equal(existsSync(path), false, `never overwrite ${path}`);
  const text = typeof document === 'string' ? document : `${JSON.stringify(document, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return digest(readFileSync(path));
}
