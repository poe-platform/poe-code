import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(base, 'evidence/fixed-freeze.json')));
const baseline = JSON.parse(readFileSync(resolve(base, 'evidence/baseline-freeze.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = () => { for (const [path, expected] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(path)), expected, path); };
verify();
const review = resolve(manifest.root, 'tests/stress/regex-execution/design/review');
const cohort = spawnSync(process.execPath, [resolve(review, 'run.mjs'), 'benign'], { cwd: manifest.root, encoding: 'utf8', timeout: 75000, maxBuffer: 262144, env: { LANG: 'C', LC_ALL: 'C' } });
const put = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
put(resolve(base, 'evidence/fixed-run.json'), cohort);
const archive = resolve(base, 'evidence/fixed'); mkdirSync(archive);
for (const name of readdirSync(resolve(review, 'evidence'))) copyFileSync(resolve(review, 'evidence', name), resolve(archive, name));
verify(); assert.equal(cohort.status, 0, cohort.stderr);
const results = Object.keys(baseline.expected).map(name => {
  const evidence = JSON.parse(readFileSync(resolve(archive, name + '.json')));
  const done = evidence.messages.find(message => message.type === 'done');
  const actual = evidence.killed || evidence.code !== 0 || !done || done.failure ? 'fail' : 'pass';
  return { name, expected: 'pass', actual, failure: done?.failure, cleanup: done?.cleanup };
});
put(resolve(base, 'evidence/fixed-summary.json'), { originalAssertionsUnchanged: true, originalRunnerBenignOnly: true, authorCommit: manifest.authorCommit, pass: results.filter(result => result.actual === 'pass').length, fail: results.filter(result => result.actual === 'fail').length, newRiskConsumed: 0, results });
console.log(cohort.stdout);
