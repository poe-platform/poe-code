import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyInventory} from '../inventory-check.mjs';
import {consumerGroups, currentConsumerPaths, negativeGroups} from '../consumers.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const owner = 'tests/plugins/qualified-current-release/';
const base = 'd5cdd3a3983c32fba8aa1d7d9a4a0d8917a47a45';
const git = (...args) => execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git', ['--no-replace-objects', ...args], {cwd: root, maxBuffer: 32 * 1024 * 1024});
const read = path => readFileSync(join(root, path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(git('show', `${base}:${owner}inventory.json`));
const candidate = JSON.parse(read(owner + 'inventory.json'));
const oldPaths = new Set(original.entries.map(entry => entry.path));
const added = candidate.entries.filter(entry => !oldPaths.has(entry.path));
const newConsumer = owner + 'current-timeout-options.mts';
const trackedActual = git('ls-files', '-z').toString().split('\0').filter(Boolean);
const tracked = [...new Set([...trackedActual, newConsumer])];
const current = currentConsumerPaths();
const negative = negativeGroups.map(group => group.path);
const rows = [];
function check(name, operation) {
  operation(); rows.push({name, status: 'PASS'});
}
function validate(value = candidate, paths = tracked, currentPaths = current, reader = read) {
  return verifyInventory(value, paths, currentPaths, negative, reader);
}

assert.ok(process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--capture'));
const originalUnknown = trackedActual.filter(path => path.endsWith('.mts') && !oldPaths.has(path) && path !== newConsumer);
const report = {at: new Date().toISOString(), observedHead: git('rev-parse', 'HEAD').toString().trim(), base, originalUnknown, originalInventorySha256: sha(git('show', `${base}:${owner}inventory.json`)), candidateInventorySha256: sha(read(owner + 'inventory.json')), newConsumerTrackedAtCheck: trackedActual.includes(newConsumer), checks: rows, productExecutions: 0, compilerExecutions: 0, builds: 0, xanExecutions: 0, fixed76Modified: false};

check('original census fails closed on exactly seven additions', () => {
  assert.equal(originalUnknown.length, 7);
  let rejection;
  try { validate(original, tracked.filter(path => path !== newConsumer), current.filter(path => oldPaths.has(path))); } catch (error) { rejection = error.message; }
  assert.match(rejection, /standalone inventory changed/u);
  report.originalFailure = rejection;
});
check('all 192 existing entries and unrelated metadata unchanged', () => {
  assert.equal(original.entries.length, 192);
  assert.deepEqual(candidate.entries.slice(0, 192), original.entries);
  for (const key of Object.keys(original).filter(key => !['entries', 'counts'].includes(key))) assert.deepEqual(candidate[key], original[key]);
});
check('exact 200 census with existing fail-closed validator', () => {
  assert.deepEqual(validate(), {'frozen-evidence': 153, current: 36, declaration: 7, 'frozen-oracle': 1, 'negative-types': 3});
  assert.equal(added.length, 8);
});
check('unchanged seven inputs match committed bytes', () => {
  for (const path of originalUnknown) assert.deepEqual(read(path), git('show', `${base}:${path}`));
});
check('timeout maintained counterpart changes only import specifier', () => {
  const source = read('tests/commands/timeout-author-20260828/repair-f22-v1/types-positive.mts').toString();
  assert.equal(read(newConsumer).toString(), source.replace('"../../../../src/commands/timeout/index.js"', '"virtual-bash/commands/timeout"'));
});
check('both new current groups have explicit strict type-only routes', () => {
  for (const name of ['timeout-options-public-types', 'webdav-directory-access-public-types']) {
    const group = consumerGroups.find(group => group.name === name);
    assert.ok(group); assert.deepEqual(group.runtime, []); assert.equal(group.files.length, 1);
    assert.equal(candidate.entries.find(entry => entry.path === group.files[0]).classification, 'current');
  }
});
check('sealed XAN three original plus one continuation identities', () => {
  const prefix = 'tests/commands/xan-module-review-20260828/actual-review-v2/';
  const before = JSON.parse(read(prefix + 'PRE-SEAL.json'));
  const continuation = JSON.parse(read(prefix + 'CONTINUATION-PRE.json'));
  for (const entry of added.filter(entry => entry.path.startsWith(prefix))) {
    const source = entry.path.endsWith('/value.mts') ? continuation : before;
    const expected = source.inputs.find(input => input.path.endsWith('/' + entry.path));
    assert.ok(expected); assert.equal(entry.sha256, expected.sha256);
    assert.equal(entry.freeze.sourceCommit, before.source);
    assert.equal(entry.freeze.packageSha256, before.package.sha256);
  }
});
check('unknown neighboring .mts remains rejected', () => {
  assert.throws(() => validate(candidate, [...tracked, 'tests/plugins/qualified-current-release/unclassified-control.mts']), /standalone inventory changed/u);
});
check('missing maintained file remains rejected', () => {
  assert.throws(() => validate(candidate, tracked.filter(path => path !== newConsumer)), /standalone inventory changed/u);
});
check('missing explicit maintained compile route remains rejected', () => {
  assert.throws(() => validate(candidate, tracked, current.filter(path => path !== newConsumer)), /explicit compile\/runtime route/u);
});
check('removing frozen rows is not an exclusion loophole', () => {
  const mutant = structuredClone(candidate);
  mutant.entries = mutant.entries.filter(entry => !entry.path.includes('xan-module-review-20260828/actual-review-v2/'));
  assert.throws(() => validate(mutant), /standalone inventory changed/u);
});
check('altered frozen input is refused without execution', () => {
  const path = added.find(entry => entry.path.endsWith('/consumer-negative.mts')).path;
  assert.throws(() => validate(candidate, tracked, current, input => input === path ? Buffer.concat([read(input), Buffer.from('\n')]) : read(input)), /historical\/declaration\/negative inventory changed/u);
});
check('altered owning seal is refused', () => {
  const path = added[0].freeze.evidence[0].path;
  assert.throws(() => validate(candidate, tracked, current, input => input === path ? Buffer.concat([read(input), Buffer.from('\n')]) : read(input)), /frozen evidence changed/u);
});
check('role swap cannot discard current typing', () => {
  const mutant = structuredClone(candidate); mutant.entries.find(entry => entry.path === newConsumer).classification = 'frozen-evidence';
  mutant.counts.current--; mutant.counts['frozen-evidence']++;
  assert.throws(() => validate(mutant), /explicit compile\/runtime route/u);
});
check('fixed76 driver/profile and production/config inputs untouched', () => {
  const paths = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'src/index.ts', 'src/plugins/index.ts', 'scripts/typecheck.mjs', 'scripts/typecheck-inputs.mjs', 'scripts/typecheck-consumers.mjs'];
  const gate = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
  paths.push(...['CANDIDATE.json', 'PROFILE.json.gz.base64', 'CLEANUP.json', 'DRIVER.json', 'INSTRUCTION-PROJECTION.json'].map(name => gate + name));
  report.protectedBindings = paths.map(path => { const bytes = read(path); assert.deepEqual(bytes, git('show', `${base}:${path}`)); return {path, sha256: sha(bytes)}; });
});

report.status = 'metadata-admission-only; types/runtime not run';
report.counts = candidate.counts;
report.entries = added;
report.inputs = ['inventory.json', 'consumers.mjs', 'current-timeout-options.mts'].map(path => ({path: owner + path, sha256: sha(read(owner + path))}));
if (process.argv[2] === '--capture') {
  const path = resolve(process.argv[3]); assert.equal(dirname(path), directory); assert.ok(!existsSync(path));
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
}
console.log(JSON.stringify({checks: rows.length, status: report.status, originalUnknown: originalUnknown.length, entries: candidate.entries.length, builds: 0, productExecutions: 0}));
