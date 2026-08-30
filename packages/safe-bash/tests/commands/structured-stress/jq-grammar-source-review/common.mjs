import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, git, root, sourceSnapshot } from '../jq-42-independent-review/common.mjs';

export { digest, root, sourceSnapshot };
export const directory = dirname(fileURLToPath(import.meta.url));
export const handoff = 'b9187c0f601c278b334f5a391d552c38c433444c';
export const expectedStructured = '120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176';
export function snapshot() {
  const result = sourceSnapshot();
  assert.equal(result.structuredSha256, expectedStructured, 'HANDOFF BLOCKER: structured source changed');
  result.tooling['tsconfig.build.json'] = digest(readFileSync(join(root, 'tsconfig.build.json')));
  result.tooling['node_modules/typescript/package.json'] = digest(readFileSync(join(root, 'node_modules/typescript/package.json')));
  return result;
}
export function artifact(name, value) {
  assert.match(name, /^[a-z0-9][a-z0-9.-]*\.json$/u);
  const path = join(directory, name);
  assert.equal(existsSync(path), false, 'never overwrite evidence');
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.slice(0, -1).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), text);
}
export function frozenPreparation() {
  const prefix = 'tests/commands/structured-stress/jq-grammar-independent/';
  const manifest = JSON.parse(readFileSync(join(root, prefix, 'manifest.json')));
  const files = [...Object.keys(manifest.ownedFiles), `${prefix}manifest.json`, `${prefix}MANIFEST.sha256`];
  for (const path of files) assert.deepEqual(readFileSync(join(root, path)), git(['show', `d5b8fff:${path}`]), `preparation differs from d5b8fff: ${path}`);
  return { commit: git(['rev-parse', 'd5b8fff']).toString().trim(), files: Object.fromEntries(files.map(path => [path, digest(readFileSync(join(root, path)))])) };
}
export function summarize(rows) {
  const ids = new Set(rows.map(row => `${row.cohort}:${row.id}`));
  const failed = new Set(rows.filter(row => !row.pass).map(row => `${row.cohort}:${row.id}`));
  return { vectors: ids.size, vectorsPassingAll: ids.size - failed.size, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length };
}
