import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { sha256, git, inventory as previousInventory } from './support.mjs';
export { save, sha256, git, root, owned, alive, localPath } from './support.mjs';
export const anchor = 'f1bb98b4ec8fd9cc198959e85f96e38880e72243';
const baseline = '3243c5a86a23408b3b844a017db6a5a94f064d1b';
const original = JSON.parse(await readFile('tests/shell-stress/kernel-reconciliation/baseline-recovered.json'));
const paths = new Set(git('ls-tree', '-r', '--name-only', baseline, 'tests/shell-stress/kernel-reconciliation').split('\n'));
for (const phase of original.phases) for (const path of Object.keys(original.manifests[phase.loaded])) if (path.startsWith('tests/')) paths.add(path);
for (const path of Object.keys(original.pinned)) paths.add(path);
for (const path of ['tests/shell-stress/expanded-gaps/native.mjs', 'tests/shell-stress/invocation-modes/capture-native.ts']) paths.add(path);
export const immutable = Object.fromEntries([...paths].sort().map(path => [path, sha256(execFileSync('git', ['show', `${baseline}:${path}`], { maxBuffer: 16e6 }))]));
export async function inventory() {
  const files = await previousInventory();
  for (const path of Object.keys(immutable)) files[path] = sha256(await readFile(path));
  return Object.fromEntries(Object.entries(files).sort());
}
export async function sourceStamp() {
  const shell = {};
  for (const name of (await readdir('src/shell')).filter(name => name.endsWith('.ts')).sort()) {
    const path = `src/shell/${name}`;
    const actual = sha256(await readFile(path));
    const committed = sha256(execFileSync('git', ['show', `${anchor}:${path}`]));
    shell[path] = { actual, committed, matches: actual === committed };
  }
  const drift = [];
  for (const [path, expected] of Object.entries(immutable)) if (sha256(await readFile(path)) !== expected) drift.push(path);
  return { timestamp: new Date().toISOString(), anchor, head: git('rev-parse', 'HEAD'), runtimeCommit: git('log', '-1', '--format=%H', '--', 'src/shell/runtime.ts'), shell, immutableDrift: drift, status: git('status', '--short'), staged: git('diff', '--cached', '--name-only'), valid: Object.values(shell).every(row => row.matches) && drift.length === 0 };
}
export async function verifyReady() {
  const text = await readFile('/tmp/safe-bash-substring-author-ready.txt', 'utf8');
  assert.ok(text.includes('SOURCE WRITE LEASE RELINQUISHED'));
  assert.ok(text.includes(anchor));
  const stamp = await sourceStamp();
  assert.equal(stamp.valid, true);
  assert.equal(stamp.shell['src/shell/runtime.ts'].actual, 'e8f1edb842d04498050d314091269974df157b11ab13cabba41d9c84a0191538');
  assert.equal(stamp.shell['src/shell/parser.ts'].actual, 'feb6cbb2f03ec0c409adeb816bec506788fb3014a23c8dd02f4002362dc4b9f2');
  return { text, sha256: sha256(text), stamp, immutable };
}
