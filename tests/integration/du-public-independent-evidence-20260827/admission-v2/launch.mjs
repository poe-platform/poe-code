import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const [commit, digest] = process.argv.slice(2);
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
assert.match(digest ?? '', /^[a-f0-9]{64}$/u);
const directory = dirname(fileURLToPath(import.meta.url));
const manifestBytes = readFileSync(join(directory, 'MANIFEST.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(manifestBytes), digest);
const manifest = JSON.parse(manifestBytes);
const names = readdirSync(directory).sort();
assert.deepEqual(names, [...manifest.files.map(record => record.path), 'MANIFEST.json'].sort());
for (const record of manifest.files) {
  const filename = join(directory, record.path);
  assert.ok(lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink());
  assert.equal(lstatSync(filename).mode & 0o777, record.mode);
  assert.equal(hash(readFileSync(filename)), record.sha256);
}
const closure = JSON.parse(readFileSync(join(directory, 'closure.json')));
for (const binary of closure.binaries) assert.equal(hash(readFileSync(binary.path)), binary.sha256);
const repository = '/Users/kjopek/Workspace/safe-bash';
const actualGit = closure.binaries[1].path;
const tracked = execFileSync(actualGit, ['ls-tree', '-r', '--name-only', commit, '--', relative(repository, directory)], { cwd: repository, timeout: 15000, maxBuffer: 1048576 }).toString().trim().split('\n');
assert.deepEqual(tracked.sort(), names.map(name => relative(repository, join(directory, name))).sort());
for (const name of names) {
  const committed = execFileSync(actualGit, ['show', `${commit}:${relative(repository, join(directory, name))}`], { cwd: repository, timeout: 15000, maxBuffer: 16777216 });
  assert.deepEqual(committed, readFileSync(join(directory, name)));
}
const executor = await import('./executor.mjs');
await executor.run({ commit, manifestSha256: digest });
