import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = new URL('./', import.meta.url);
const root = new URL('../../../../../', base);
const prefix = 'tests/stress/regex-execution/design/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(new URL(path, root));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, maxBuffer: 262144 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
assert(!existsSync(new URL('evidence/build.json', base)), 'NO_REBUILD_OVERWRITE');
assert.equal(git('diff', 'HEAD', '--', prefix + 'client.ts', prefix + 'protocol.ts', prefix + 'matching.ts', prefix + 'worker.ts', prefix + 'revision'), '');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', prefix + 'revision'), '');
const baseline = JSON.parse(readFileSync('/tmp/regex-revision-baseline-ready.txt', 'utf8'));
assert.equal(baseline.prototype, '6a19d72697a73ec03be929e4494a00afb87edaecdd3a43d5dfc5e624e7d202f2');
mkdirSync(new URL('evidence/', base));
mkdirSync(new URL('.temporary/', base));
const args = [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('tsconfig.json', base)), '--listFiles', '--listEmittedFiles', '--pretty', 'false'];
const compile = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
writeFileSync(new URL('evidence/compiler.json', base), JSON.stringify({ args, status: compile.status, error: compile.error?.message, stdout: compile.stdout, stderr: compile.stderr }, null, 2) + '\n', { flag: 'wx' });
assert.equal(compile.status, 0, 'COMPILER_FAILED');
const source = {}; const built = {};
for (const line of compile.stdout.split('\n')) {
  if (line.startsWith('TSFILE: ')) {
    const path = line.slice(8);
    const relative = path.slice(fileURLToPath(new URL('.temporary/js/', base)).length);
    built[relative] = hash(readFileSync(path));
  } else if (line.startsWith(fileURLToPath(root))) {
    source[line.slice(fileURLToPath(root).length)] = hash(readFileSync(line));
  }
}
assert.equal(Object.keys(built).length, 4);
for (const path of ['tsconfig.json', prefix + 'tsconfig.json', prefix + 'revision/tsconfig.json', 'node_modules/typescript/package.json', 'node_modules/typescript/lib/_tsc.js', 'node_modules/typescript/bin/tsc', 'node_modules/@types/node/package.json']) source[path] = hash(read(path));
const harness = {};
for (const name of ['PLAN.md', '.gitignore', 'tsconfig.json', 'fixtures.mjs', 'child.mjs', 'run.mjs', 'prepare.mjs', 'audit.mjs', 'cleanup.mjs']) harness[name] = hash(readFileSync(new URL(name, base)));
const graph = {};
for (const name of ['worker', 'matching', 'protocol']) {
  const text = readFileSync(new URL('.temporary/js/' + prefix + name + '.js', base), 'utf8');
  assert(!/\b(?:eval|Function)\s*\(|\bprocess\.|node:(?:fs|net|http|https|child_process)|\bimport\s*\(/u.test(text));
  graph[name] = text.split('\n').filter(line => line.startsWith('import '));
}
const metadata = {
  utc: new Date().toISOString(), baseline, headAtBuild: git('rev-parse', 'HEAD'),
  codeCommit: git('log', '-1', '--format=%H', '--', prefix + 'client.ts'),
  harnessCommit: git('log', '-1', '--format=%H', '--', prefix + 'revision/fixtures.mjs'),
  status: git('status', '--short'), runtime: { execPath: process.execPath, sha256: hash(readFileSync(process.execPath)), versions: process.versions, platform: process.platform, arch: process.arch },
  compilerVersion: JSON.parse(read('node_modules/typescript/package.json')).version, source, built, harness, graph,
};
writeFileSync(new URL('evidence/build.json', base), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sources: Object.keys(source).length, emitted: Object.keys(built).length, codeCommit: metadata.codeCommit, harnessCommit: metadata.harnessCommit }));
