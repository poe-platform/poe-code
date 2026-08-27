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
  const command = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, maxBuffer: 262144 });
  assert.equal(command.status, 0, command.stderr);
  return command.stdout.trim();
};
assert.equal(git('diff', 'HEAD', '--', prefix + 'review'), '');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', prefix + 'review'), '');
assert(!existsSync(new URL('evidence/build.json', base)), 'NO_REBUILD_RETRY');
const frozen = JSON.parse(read(prefix + 'frozen.json'));
const source = {};
for (const [path, expected] of Object.entries(frozen.source)) {
  source[path] = hash(read(path));
  assert.equal(source[path], expected, path);
}
assert.equal(process.version, frozen.runtime.node);
assert.equal(process.versions.v8, frozen.runtime.v8);
assert.equal(process.platform, frozen.runtime.platform);
assert.equal(process.arch, frozen.runtime.arch);
assert.equal(JSON.parse(read('node_modules/typescript/package.json')).version, frozen.compiler);
mkdirSync(new URL('.temporary/', base));
mkdirSync(new URL('evidence/', base));
const args = [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('../tsconfig.json', base)), '--outDir', fileURLToPath(new URL('.temporary/js', base)), '--listFiles', '--listEmittedFiles', '--pretty', 'false'];
const compile = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
writeFileSync(new URL('evidence/compiler.json', base), JSON.stringify({ args, status: compile.status, error: compile.error?.message, stdout: compile.stdout, stderr: compile.stderr }, null, 2) + '\n');
assert.equal(compile.status, 0, 'COMPILER_FAILED');
const built = {};
const actualSources = {};
for (const line of compile.stdout.split('\n')) {
  if (line.startsWith('TSFILE: ')) {
    const path = line.slice(8);
    const relative = path.slice(fileURLToPath(new URL('.temporary/js/', base)).length);
    built[relative] = hash(readFileSync(path));
    assert.equal(built[relative], frozen.built[prefix + '.build/js/' + relative], relative);
  } else if (line.startsWith(fileURLToPath(root))) {
    const path = line.slice(fileURLToPath(root).length);
    actualSources[path] = hash(readFileSync(line));
    assert.equal(actualSources[path], frozen.source[path], path);
  }
}
assert.equal(Object.keys(built).length, Object.keys(frozen.built).length);
const graph = {};
for (const name of ['worker', 'matching', 'protocol']) {
  const path = prefix + name + '.js';
  const text = readFileSync(new URL('.temporary/js/' + path, base), 'utf8');
  graph[name] = { sha256: built[path], imports: text.split('\n').filter(line => line.startsWith('import ')) };
  assert(!/\b(?:eval|Function)\s*\(|\bprocess\.|node:(?:fs|net|http|https|child_process)|\bimport\s*\(/u.test(text));
}
const metadata = {
  utc: new Date().toISOString(), authorFreeze: git('rev-parse', '4484026'), reviewFreeze: git('rev-parse', 'HEAD'),
  status: git('status', '--short'), runtime: { execPath: process.execPath, sha256: hash(readFileSync(process.execPath)), versions: process.versions, platform: process.platform, arch: process.arch },
  frozenSha256: hash(read(prefix + 'frozen.json')), bundleSha256: hash(read(prefix + 'source-bundle.json')),
  compilerVersion: frozen.compiler, source, actualSources, built, graph,
};
writeFileSync(new URL('evidence/build.json', base), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ sources: Object.keys(source).length, compiledSources: Object.keys(actualSources).length, emitted: Object.keys(built).length, exactAuthorBuild: true }));
