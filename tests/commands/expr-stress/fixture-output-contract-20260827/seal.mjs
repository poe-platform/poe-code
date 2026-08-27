import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
assert.equal(process.argv[2], '--seal');
assert(!existsSync(join(owned, 'SEAL.json')));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
};
const json = name => JSON.parse(readFileSync(join(owned, name)));
const base = '21220b465537bf45ffcfb36740956a69f43bf75e';
const fixture = 'be72c9c86c1a6cb00a0b14d86a7f3f8eb7b6c5e7';
const grammar = 'tests/commands/expr/grammar.test.ts';
const before = json('before-01/archive-source.before.json');
const after = json('after-01/archive-source.before.json');
assert.deepEqual(before.map(entry => entry.path), after.map(entry => entry.path));
const deltas = before.flatMap((entry, index) => JSON.stringify(entry) === JSON.stringify(after[index]) ? [] : [{ before: entry, after: after[index] }]);
assert.deepEqual(deltas.map(delta => delta.before.path), [grammar]);
assert.equal(hash(readFileSync(join(root, grammar))), deltas[0].after.sha256);
assert.equal(json('assertion-audit.json').changed, 2);
assert.equal(json('before-01/runtime-frozen.json').summary.passed, 11);
assert.deepEqual(json('before-01/runtime-frozen.json').summary.red, ['syntax-output-one']);
assert.deepEqual(git(['diff-tree', '--no-commit-id', '--name-only', '-r', fixture]).toString().trim().split('\n'), [grammar]);
const snapshots = join(owned, 'source-bindings');
mkdirSync(snapshots);
const sources = [
  'src/commands/expr/index.ts', 'src/commands/expr/internal.ts', 'src/commands/expr/syntax.ts', 'src/commands/expr/README.md',
  'src/contracts/io.ts', 'src/contracts/command.ts', 'src/contracts/command.md', 'src/contracts/errors.ts',
  'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'tests/commands/expr/diagnostics-regression.test.ts',
];
const bindings = [];
for (const source of sources) {
  const bytes = git(['show', `${base}:${source}`]);
  const target = `${source.replaceAll('/', '__')}.data`;
  writeFileSync(join(snapshots, target), bytes, { flag: 'wx' });
  bindings.push({ source, commit: base, snapshot: `source-bindings/${target}`, sha256: hash(bytes), gitBlob: git(['rev-parse', `${base}:${source}`]).toString().trim() });
}
for (const source of ['tests/commands/expr-author/diagnostics-fix/REPORT.md', 'tests/commands/expr-author/diagnostics-fix/SEAL.json']) {
  const commit = '7fc76f3917a38c0cc39d46c02383c947fa3ac110';
  const bytes = git(['show', `${commit}:${source}`]);
  assert.deepEqual(bytes, readFileSync(join(root, source)));
  const target = source.endsWith('REPORT.md') ? 'author-policy-REPORT.md.data' : 'author-policy-SEAL.json.data';
  writeFileSync(join(snapshots, target), bytes, { flag: 'wx' });
  bindings.push({ source, commit, snapshot: `source-bindings/${target}`, sha256: hash(bytes), gitBlob: git(['rev-parse', `${commit}:${source}`]).toString().trim() });
}
writeFileSync(join(snapshots, 'bindings.json'), `${JSON.stringify(bindings, null, 2)}\n`, { flag: 'wx' });
for (const phase of ['before-01', 'after-01', 'boundary-01']) assert.equal(json(`${phase}/cleanup.json`).removed, true);
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const absolute = join(directory, name), entry = prefix ? `${prefix}/${name}` : name;
    assert(!name.startsWith('.archive-') && !name.startsWith('.boundary-'));
    const stat = lstatSync(absolute);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) return [{ path: entry, kind: 'directory' }, ...inventory(absolute, entry)];
    return [{ path: entry, kind: 'file', sha256: hash(readFileSync(absolute)), size: stat.size }];
  });
}
const entries = inventory(owned);
const data = { schema: 1, createdAt: new Date().toISOString(), base, fixtureCommit: fixture, sourceFixtureDeltas: deltas, runtimeFinding: 'RED: unchanged frozen syntax-output-one, actual status3, stdoutempty, 34-byte limit refusal; policy documented in author evidence but conflicts with stdout-only README wording.', fixtureBefore: { passed: 239, total: 241 }, fixtureAfter: { passed: 241, total: 241 }, runtime: { passed: 11, total: 12 }, inventoryExcludes: ['SEAL.json itself only'], inventorySha256: hash(JSON.stringify(entries)), entries };
writeFileSync(join(owned, 'SEAL.json'), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ files: entries.filter(entry => entry.kind === 'file').length, sha256: hash(JSON.stringify(entries)), runtime: data.runtime }));
