import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
function visit(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (path === 'MANIFEST.json') continue;
    if (entry.isDirectory()) visit(path);
    else files[path] = { sha256: hash(readFileSync(join(root, path))), bytes: readFileSync(join(root, path)).length };
  }
}
visit('');
const freeze = JSON.parse(readFileSync(join(root, 'attempt-1/freeze.json')));
for (const [path, identity] of Object.entries(freeze.selected.candidate.inputs)) {
  const bytes = execFileSync('git', ['show', freeze.candidate + ':' + path], { cwd: repo, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(hash(bytes), identity.sha256, path);
}
assert.equal(hash(readFileSync(join(repo, 'src/commands/text.ts'))), freeze.selected.candidate.inputs['src/commands/text.ts'].sha256);
for (const variant of ['baseline', 'candidate', 'moved-candidate', 'baseline-instrumented', 'candidate-instrumented']) {
  const result = JSON.parse(readFileSync(join(root, 'attempt-1', variant + '.json')));
  assert.equal(result.rows.length, 21); assert.ok(result.rows.every(row => row.equivalent));
}
for (const variant of ['baseline-text-instrumented', 'candidate', 'candidate-instrumented']) {
  const result = JSON.parse(readFileSync(join(root, 'caps-1', variant + '.json')));
  assert.equal(result.rows.length, 13); assert.ok(result.rows.every(row => row.equivalent));
}
for (const path of ['attempt-1/cleanup.json', 'caps-1/cleanup.json']) {
  const cleanup = JSON.parse(readFileSync(join(root, path)));
  assert.ok(cleanup.successful && cleanup.beforeAfterTreesMatch && cleanup.scratchRemoved);
  assert.equal(cleanup.remainingOwnedChildren, 0);
}
const manifest = { candidate: freeze.candidate, textSha256: freeze.selected.candidate.inputs['src/commands/text.ts'].sha256, authorOnly: true, files };
if (process.argv.includes('--capture')) writeFileSync(join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
else assert.deepEqual(JSON.parse(readFileSync(join(root, 'MANIFEST.json'))), manifest);
console.log(JSON.stringify({ checked: Object.keys(files).length, candidate: freeze.candidate, readOnly: !process.argv.includes('--capture') }));
