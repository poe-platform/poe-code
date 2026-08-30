import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(base, 'evidence/baseline-freeze.json')));
const root = manifest.snapshot;
const prefix = 'tests/stress/regex-execution/design/';
const review = resolve(root, prefix, 'review');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [path, expected] of Object.entries({ ...manifest.sources, ...manifest.originals })) assert.equal(hash(readFileSync(resolve(root, path))), expected, path);
assert.equal(hash(readFileSync(process.execPath)), manifest.runtime.sha256);
const frozen = JSON.parse(readFileSync(resolve(root, prefix, 'frozen.json')));
const destination = resolve(review, '.temporary/js');
mkdirSync(resolve(review, 'evidence'), { recursive: true });
const args = [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, prefix, 'tsconfig.json'), '--outDir', destination, '--listFiles', '--listEmittedFiles', '--pretty', 'false'];
const compiler = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
const put = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
put(resolve(base, 'evidence/baseline-compiler.json'), { args, ...compiler });
assert.equal(compiler.status, 0, compiler.stderr + compiler.stdout);
const built = {};
for (const line of compiler.stdout.split('\n')) {
  if (line.startsWith('TSFILE: ')) {
    const path = line.slice(8); const relative = path.slice(destination.length + 1);
    built[relative] = hash(readFileSync(path));
    assert.equal(built[relative], frozen.built[prefix + '.build/js/' + relative], relative);
  }
}
assert.equal(Object.keys(built).length, Object.keys(frozen.built).length);
put(resolve(review, 'evidence/build.json'), { runtime: manifest.runtime, source: { ...manifest.sources, ...manifest.originals }, built, baseline: manifest.revisions });
const cohort = spawnSync(process.execPath, [resolve(review, 'run.mjs'), 'benign'], { cwd: root, encoding: 'utf8', timeout: 75000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
put(resolve(base, 'evidence/baseline-run.json'), cohort);
const archive = resolve(base, 'evidence/baseline'); mkdirSync(archive);
for (const name of readdirSync(resolve(review, 'evidence'))) copyFileSync(resolve(review, 'evidence', name), resolve(archive, name));
assert.equal(cohort.status, 0, cohort.stderr);
const results = Object.entries(manifest.expected).map(([name, expected]) => {
  const evidence = JSON.parse(readFileSync(resolve(archive, name + '.json')));
  const done = evidence.messages.find(message => message.type === 'done');
  const actual = evidence.killed || evidence.code !== 0 || !done || done.failure ? 'fail' : 'pass';
  return { name, expected, actual, matchesExpectation: actual === expected, failure: done?.failure, cleanup: done?.cleanup };
});
put(resolve(base, 'evidence/baseline-summary.json'), { originalAssertionsUnchanged: true, originalRunnerBenignOnly: true, emittedHashesExactlyMatch: Object.keys(built).length, pass: results.filter(result => result.actual === 'pass').length, fail: results.filter(result => result.actual === 'fail').length, newRiskConsumed: 0, results });
console.log(cohort.stdout);
assert(results.every(result => result.matchesExpectation), 'BASELINE_EXPECTATION_MISMATCH');
