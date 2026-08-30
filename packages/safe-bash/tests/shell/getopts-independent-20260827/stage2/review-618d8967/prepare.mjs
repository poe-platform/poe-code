import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { own, repo, candidate, author, freeze, work, hash, git, write, save, inventory } from './harness.mjs';

assert(!fs.existsSync(work), 'exclusive work directory required');
for (const name of ['source', 'home', 'tmp', 'cache', 'npm-cache', 'logs', 'tools', 'pack']) fs.mkdirSync(path.join(work, name), { recursive: true });
const source = path.join(work, 'source');
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'tests/shell', 'tests/contracts', 'tests/commands/helpers.ts', 'tests/commands/streams.test.ts', 'tests/commands/pipelines.test.ts', 'tests/commands/network', 'tests/commands/network-zero-caps-review', 'tests/integration/owned-output-production-rebase/author', 'tests/integration/owned-output-production-rebase/author-public', 'tests/integration/owned-output-production-independent-20260827'];
const records = git('ls-tree', '-r', '-z', candidate, '--', ...selected).toString().split('\0').filter(Boolean).map(record => { const tab = record.indexOf('\t'); const [mode, kind, oid] = record.slice(0, tab).split(' '); return { path: record.slice(tab + 1), mode, kind, oid }; });
assert(records.every(record => record.kind === 'blob' && ['100644', '100755'].includes(record.mode) && !record.path.endsWith('AGENTS.md')));
const tar = git('archive', candidate, '--', ...selected);
write(path.join(work, 'candidate.tar'), tar);
execFileSync('/usr/bin/tar', ['-xf', path.join(work, 'candidate.tar'), '-C', source]);
const before = inventory(source);
assert.deepEqual(Object.keys(before).filter(name => before[name].kind === 'file').sort(), records.map(record => record.path).sort());
for (const record of records) {
  const bytes = fs.readFileSync(path.join(source, record.path));
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), record.oid, record.path);
  assert.equal(before[record.path].mode, record.mode);
}
const baselineBytes = git('show', `${author}:tests/shell/getopts/runtime/baseline.json`);
write(path.join(work, 'author-baseline.json'), baselineBytes);
const baseline = JSON.parse(baselineBytes);
for (const name of ['src/shell/runtime.ts', 'src/shell/shell.ts']) assert.equal(hash(git('show', `${baseline.baseline}:${name}`)), baseline.bindings[name]);
const additions = baseline.ownedOutputBaselinePatch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1));
const combined = ['src/shell/runtime.ts', 'src/shell/shell.ts'].map(name => fs.readFileSync(path.join(source, name), 'utf8')).join('\n');
assert(additions.every(line => combined.split('\n').includes(line)), 'accepted owned-output added lines missing');
const protection = {};
for (const [name, expected] of Object.entries(baseline.protectedPaths)) { const bytes = git('show', `${candidate}:${name}`); assert.equal(hash(bytes), expected, name); protection[name] = { sha256: expected, bytes: bytes.length }; }
const ownProductDelta = git('diff-tree', '--no-commit-id', '--name-only', '-r', `${candidate}^`, candidate, '--', 'src').toString().trim().split('\n');
assert.deepEqual(ownProductDelta, ['src/shell/runtime.ts', 'src/shell/shell.ts']);
for (const name of ['typescript', 'tsx', 'esbuild', '@esbuild', '@types/node', 'undici-types', 'fsevents']) fs.cpSync(path.join(repo, 'node_modules', name), path.join(source, 'node_modules', name), { recursive: true, dereference: true });
const tools = inventory(path.join(source, 'node_modules'));
write(path.join(work, 'candidate.commit.data'), git('cat-file', 'commit', candidate));
write(path.join(work, 'candidate.root-tree.data'), git('cat-file', 'tree', `${candidate}^{tree}`));
save(path.join(work, 'BINDING.json'), { candidate, author, freeze, observedAt: new Date().toISOString(), inspectionBeganAfterFreezeAuthentication: true, source, selected, selectedBlobs: records, archiveSHA256: hash(tar), sourceBefore: before, tools, node: { path: process.execPath, version: process.version, sha256: hash(fs.readFileSync(process.execPath)) }, baseline: { commit: baseline.baseline, bindings: baseline.bindings, protected: protection, acceptedOwnedOutputAddedLines: additions.length, addedLinesRetained: true }, ownProductDelta, wholeBaselineDelta: git('diff-tree', '--no-commit-id', '--name-status', '-r', baseline.baseline, candidate, '--', 'src').toString(), candidateTree: git('rev-parse', `${candidate}^{tree}`).toString().trim(), reachableRefs: git('for-each-ref', `--contains=${candidate}`, '--format=%(refname)').toString().trim().split('\n'), packageManifestSHA256: before['package.json'].sha256, toolCopies: 'Regular copies of explicit public installed development dependencies; no symlinks/private engine copies.' });
console.log(JSON.stringify({ selectedFiles: records.length, archiveBytes: tar.length, protected: Object.keys(protection).length, ownedOutputAddedLines: additions.length }));
