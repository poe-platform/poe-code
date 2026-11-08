import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const owned = resolve('tests/shell-stress/first-read-contract-review');
const candidate = resolve(owned, '.scratch/candidate');
assert.equal(existsSync(resolve(owned, '.scratch')), false, 'Refuse existing owned scratch state');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = JSON.parse(readFileSync(resolve(owned, 'evidence/freeze.json')));
const inputs = JSON.parse(readFileSync(resolve(owned, 'evidence/inputs.json')));
for (const tool of inputs.tools) assert.equal(hash(readFileSync(tool.path)), tool.sha256, `Changed dev tool ${tool.path}`);
const paths = new Map(pin.manifest.filter(entry => entry.path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(entry.path)).map(entry => [entry.path, entry.sha256]));
for (const input of inputs.manifest.filter(entry => entry.classification.startsWith('unchanged execution'))) paths.set(input.path, input.sha256);
for (const [path, sha256] of paths) {
  const archive = resolve(owned, 'preserved', `${path}.data`);
  const bytes = existsSync(archive) ? readFileSync(archive) : execFileSync('git', ['show', `${pin.head}:${path}`], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(hash(bytes), sha256, `Cannot restore frozen ${path}`);
  mkdirSync(dirname(resolve(candidate, path)), { recursive: true });
  writeFileSync(resolve(candidate, path), bytes, { flag: 'wx' });
}
console.log(JSON.stringify({ candidate, verifiedFiles: paths.size, head: pin.head, dependencies: 'Existing explicitly hash-checked dev tooling; no install' }));
