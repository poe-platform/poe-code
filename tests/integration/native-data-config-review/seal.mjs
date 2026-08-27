import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const native = 'tests/commands/regex-execution/continuation/artifacts/native';
const candidate = '78e80717b9791a4bc5f49005b962b1da9232335d';
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = (base, paths) => paths.map(path => {
  const bytes = readFileSync(join(base, path));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
const paths = base => readdirSync(base, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => relative(base, join(entry.parentPath, entry.name))).sort();
const sourcePaths = git('ls-files', '-z', '--', 'src').split('\0').filter(Boolean);
const snapshot = () => ({
  head: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD:src'),
  status: git('status', '--porcelain=v1'),
  source: manifest(root, sourcePaths),
  configs: manifest(root, ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']),
  native: manifest(join(root, native), paths(join(root, native)))
});
const started = new Date().toISOString();
const before = snapshot();
const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config;
assert.deepEqual(config, JSON.parse(git('show', `${candidate}:tsconfig.json`)));
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, { noEmit: true, incremental: false });
const parentParsed = ts.parseJsonConfigFileContent(JSON.parse(git('show', `${candidate}^:tsconfig.json`)), ts.sys, root, { noEmit: true, incremental: false });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const files = program.getSourceFiles().map(file => relative(root, file.fileName)).sort();
const sourceInputs = files.filter(path => path.startsWith('src/'));
const testInputs = files.filter(path => path.startsWith('tests/'));
const otherInputs = files.filter(path => !path.startsWith('src/') && !path.startsWith('tests/'));
const discovered = globSync('tests/**/*.test.ts', { cwd: root, exclude: path => path === native }).sort();
const tracked = git('ls-files', '-z', '--', 'tests').split('\0').filter(path => path.endsWith('.test.ts')).sort();
const preserved = new Set(parsed.fileNames);
const removed = parentParsed.fileNames.filter(path => !preserved.has(path)).map(path => relative(root, path));
assert.equal(removed.length, 6);
assert.ok(removed.every(path => path.startsWith(native + '/')));
assert.ok(discovered.every(path => files.includes(path)));
assert.ok(tracked.every(path => files.includes(path)));
assert.ok(!files.some(path => path.startsWith('tests/integration/native-data-config-review/.scratch/')));
const inputManifest = manifest(root, files);
const after = snapshot();
assert.deepEqual(after.native, before.native);
assert.deepEqual(after.native, JSON.parse(readFileSync(join(owned, 'attempt-01/live-before.json'), 'utf8')).nativeFiles);
assert.deepEqual(after.configs, before.configs);
const result = {
  started, finished: new Date().toISOString(), mode: 'read-only current file census, not semantic diagnostics or test execution',
  before, after,
  headStable: before.head === after.head,
  sourceStable: JSON.stringify(before.source) === JSON.stringify(after.source),
  configStable: JSON.stringify(before.configs) === JSON.stringify(after.configs),
  counts: { total: files.length, production: sourceInputs.length, testTree: testInputs.length, other: otherInputs.length, discovered: discovered.length, discoveredIncluded: discovered.length, tracked: tracked.length, trackedIncluded: tracked.length },
  trackedAddedSinceCandidate: git('diff', '--name-status', candidate, 'HEAD', '--', 'tests/**/*.test.ts'),
  candidateToLiveSourceCommits: git('log', '--format=%H %s', `${candidate}..HEAD`, '--', 'src'),
  removedOnly: removed, discovered, tracked, sourceInputs, testInputs, otherInputs, inputManifest,
  scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url)))
};
writeFileSync(join(owned, 'final-census.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ counts: result.counts, head: after.head, sourceTree: after.sourceTree, headStable: result.headStable, sourceStable: result.sourceStable, removedOnly: removed }, null, 2));
