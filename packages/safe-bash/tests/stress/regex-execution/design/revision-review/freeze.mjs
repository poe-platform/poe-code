import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(base, '../../../../..');
const prefix = 'tests/stress/regex-execution/design/';
const snapshot = resolve(base, '.temporary/baseline');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16777216 });
const revisions = Object.fromEntries(['4484026', 'aba917c', 'ad4c5ad', '3b27782'].map(ref => [ref, git('rev-parse', ref).toString().trim()]));
const frozenBytes = git('show', `${revisions.aba917c}:${prefix}frozen.json`);
const frozen = JSON.parse(frozenBytes);
const bundleBytes = git('show', `${revisions.aba917c}:${prefix}source-bundle.json`);
const bundle = JSON.parse(bundleBytes);
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: 'wx' }); };
const sources = {};
for (const [path, expected] of Object.entries(frozen.source)) {
  const bytes = Object.hasOwn(bundle, path) ? Buffer.from(bundle[path]) : path.startsWith('node_modules/') ? readFileSync(resolve(root, path)) : git('show', `${revisions['4484026']}:${path}`);
  assert.equal(hash(bytes), expected, path);
  if (path.startsWith(prefix)) assert.deepEqual(bytes, git('show', `${revisions['4484026']}:${path}`));
  put(resolve(snapshot, path), bytes);
  sources[path] = hash(bytes);
}
for (const path of ['node_modules/typescript/bin/tsc', 'node_modules/typescript/lib/tsc.js', 'node_modules/undici-types/package.json']) {
  const bytes = readFileSync(resolve(root, path)); put(resolve(snapshot, path), bytes); sources[path] = hash(bytes);
}
const originals = {};
for (const name of ['child.mjs', 'fixtures.mjs', 'run.mjs', 'prepare.mjs', 'PLAN.md']) {
  const path = `${prefix}review/${name}`;
  const bytes = git('show', `${revisions.ad4c5ad}:${path}`);
  assert.deepEqual(bytes, git('show', `${revisions['3b27782']}:${path}`));
  put(resolve(snapshot, path), bytes); originals[path] = hash(bytes);
}
put(resolve(snapshot, prefix, 'frozen.json'), frozenBytes);
put(resolve(snapshot, prefix, 'source-bundle.json'), bundleBytes);
for (const name of ['REPORT.md', 'evidence/idle-exit.json', 'evidence/live-source.json', 'evidence/benign-schedule.json']) {
  put(resolve(snapshot, 'archived-review', name), git('show', `${revisions['3b27782']}:${prefix}review/${name}`));
}
const scenarios = (await import(new URL('./.temporary/baseline/' + prefix + 'review/fixtures.mjs', import.meta.url))).scenarios;
const manifest = { utc: new Date().toISOString(), snapshot, revisions, runtime: { node: process.version, v8: process.versions.v8, executable: process.execPath, sha256: hash(readFileSync(process.execPath)) }, sources, originals, frozenSha256: hash(frozenBytes), bundleSha256: hash(bundleBytes), expected: Object.fromEntries(scenarios.map(name => [name, ['idle-exit', 'live-source'].includes(name) ? 'fail' : 'pass'])), expectedBaseline: { pass: 14, fail: 2 }, risk: { archivedCumulative: 12, separatelyAuthorized: 6, verifierMaximum: 2, verifierConsumed: 0, authorReservation: 2, rootUnusedReservation: 2 } };
put(resolve(base, 'evidence/baseline-freeze.json'), JSON.stringify(manifest, null, 2) + '\n');
put('/tmp/regex-revision-baseline-ready.txt', JSON.stringify({ status: 'snapshot ready; original sixteen expectations frozen before author edits', snapshot, revisions, manifest: resolve(base, 'evidence/baseline-freeze.json'), manifestSha256: hash(JSON.stringify(manifest, null, 2) + '\n'), prototype: sources[prefix + 'client.ts'], originalChild: originals[prefix + 'review/child.mjs'], originalFixtures: originals[prefix + 'review/fixtures.mjs'] }, null, 2) + '\n');
console.log(JSON.stringify({ snapshot, revisions, sources: Object.keys(sources).length, originalReviewFiles: Object.keys(originals).length, marker: '/tmp/regex-revision-baseline-ready.txt' }));
