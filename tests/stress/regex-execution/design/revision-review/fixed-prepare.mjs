import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const repository = resolve(base, '../../../../..');
const baseline = JSON.parse(readFileSync(resolve(base, 'evidence/baseline-freeze.json')));
const root = resolve(base, '.temporary/fixed');
const prefix = 'tests/stress/regex-execution/design/';
const review = resolve(root, prefix, 'review');
const commit = process.argv[2]; assert.match(commit ?? '', /^[0-9a-f]{40}$/u, 'FULL_PINNED_COMMIT_REQUIRED');
const marker = readFileSync('/tmp/regex-revision-author-ready.txt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 16777216 });
assert.equal(git('rev-parse', commit).toString().trim(), commit);
assert.equal(hash(readFileSync(process.execPath)), baseline.runtime.sha256);
const putBytes = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: 'wx' }); };
const put = (path, value) => putBytes(path, JSON.stringify(value, null, 2) + '\n');
const source = {}; const files = {}; const changed = {};
const prototype = ['client.ts', 'matching.ts', 'protocol.ts', 'worker.ts'].map(name => prefix + name);
for (const [path, expected] of Object.entries({ ...baseline.sources, ...baseline.originals })) {
  const original = readFileSync(resolve(baseline.snapshot, path)); assert.equal(hash(original), expected, path);
  const bytes = prototype.includes(path) ? git('show', `${commit}:${path}`) : original;
  if (hash(bytes) !== expected) changed[path] = { before: expected, after: hash(bytes) };
  if (prototype.includes(path)) assert.deepEqual(bytes, readFileSync(resolve(repository, path)), 'HANDOFF_SOURCE_DRIFT: ' + path);
  const destination = resolve(root, path); putBytes(destination, bytes); source[path] = hash(bytes); files[destination] = hash(bytes);
}
assert(Object.hasOwn(changed, prefix + 'client.ts'), 'EXPECTED_FIXED_CLIENT');
const destination = resolve(review, '.temporary/js');
const args = [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, prefix, 'tsconfig.json'), '--outDir', destination, '--listFiles', '--listEmittedFiles', '--pretty', 'false'];
const compiler = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
put(resolve(base, 'evidence/fixed-compiler.json'), { args, ...compiler }); assert.equal(compiler.status, 0, compiler.stderr + compiler.stdout);
const built = {};
for (const line of compiler.stdout.split('\n')) if (line.startsWith('TSFILE: ')) {
  const path = line.slice(8); built[path.slice(destination.length + 1)] = hash(readFileSync(path)); files[path] = hash(readFileSync(path));
}
assert.equal(Object.keys(built).length, 17);
for (const name of ['guards-child.mjs', 'guards-run.mjs', 'fixed-prepare.mjs', 'fixed-run.mjs']) { const path = resolve(base, name); files[path] = hash(readFileSync(path)); }
files[process.execPath] = hash(readFileSync(process.execPath));
put(resolve(review, 'evidence/build.json'), { runtime: baseline.runtime, source, built, authorCommit: commit });
putBytes(resolve(base, 'evidence/author-ready.txt'), marker);
put(resolve(base, 'evidence/fixed-freeze.json'), { utc: new Date().toISOString(), root, authorCommit: commit, changed, baselineRevisions: baseline.revisions, originalExpectations: baseline.originals, compilerVersion: JSON.parse(readFileSync(resolve(root, 'node_modules/typescript/package.json'))).version, runtime: baseline.runtime, source, built, files, markerSha256: hash(marker), prototypeDiff: git('diff', baseline.revisions['4484026'], commit, '--', ...prototype).toString(), expectedFixed: { pass: 16, fail: 0 }, expectedGuards: { pass: 12, fail: 0 }, newRiskConsumed: 0 });
console.log(JSON.stringify({ root, authorCommit: commit, changed, built: Object.keys(built).length, guards: 12, newRiskConsumed: 0 }));
