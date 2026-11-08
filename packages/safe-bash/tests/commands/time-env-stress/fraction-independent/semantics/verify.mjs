import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const repo = join(here, '../../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(readFileSync(join(here, name)));
const inventory = () => Object.fromEntries(readdirSync(here).sort().filter(name => name !== 'MANIFEST.json').map(name => {
  assert.ok(statSync(join(here, name)).isFile(), 'owned evidence should contain only regular files');
  return [name, hash(readFileSync(join(here, name)))];
}));
const frozen = json('FREEZE.json');
for (const [name, digest] of Object.entries(frozen.files)) assert.equal(hash(readFileSync(join(here, name))), digest);
const source = json('source-manifest.json');
assert.equal(source.commit, 'c7823633ee99f711f1319ace59d4cf2b7f622ecc');
assert.equal(source.tree, '47b9a9d5763c036bdb8eab8ee25091ae5bd64a20');
assert.equal(source.resultStatus, 1);
assert.equal(Object.keys(source.sourceBefore).length, 215);
assert.deepEqual(source.sourceBefore, source.sourceAfter);
assert.deepEqual(source.sourceBefore, source.sourceFinal);
assert.equal(source.sourceUnchanged && source.compilerConfigUnchanged && source.distUnchanged, true);
assert.equal(existsSync(source.scratch), false);
assert.equal(existsSync(json('native-profile.json').cwd), false);
for (const [path, digest] of Object.entries(source.sourceBefore)) {
  const result = spawnSync('/usr/bin/git', ['show', source.commit + ':' + path], { cwd: repo, timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, path);
  assert.equal(hash(result.stdout), digest, path);
}
const results = json('classification-v2.json');
assert.equal(results.total, 312);
assert.equal(results.originalHarnessPasses, 301);
assert.equal(results.originalHarnessFailures, 11);
assert.equal(results.strictNativeTotal, 286);
assert.equal(results.strictNativeMatches, 268);
assert.equal(results.preservedHistoricalICULabelMismatches, 5);
assert.equal(results.noProductRerun, true);
assert.equal(results.sourceProof.proofRows, 1624);
assert.equal(results.sourceProof.sourceBranchMatches, 1624);
assert.equal(results.sourceProof.magnitudeMatches, 1622);
const originalMatrix = readFileSync(join(repo, 'tests/commands/time-env/fix-review/evidence/after/fresh-native-matrix.json'));
assert.equal(hash(originalMatrix), json('preserved-ICU-profile-v2.json').sha256);
const primary = json('primary-fetch.json').results;
assert.equal(primary.find(row => row.id === 'release-archive').sha256, json('native-profile.json').archiveSha256);
assert.ok(primary.find(row => row.id === 'posix-2024').status === 0);
assert.ok(source.records.some(row => row.args[0]?.endsWith('typescript/bin/tsc') && row.status === 0));
assert.ok(source.records.every(row => row.signal === null && row.error === null));
const existing = ['tests/commands/time-env/date.test.ts', 'tests/commands/time-env/fraction-expansion/AUTHOR_HANDOFF.md',
  'tests/commands/time-env/fraction-expansion/SEMANTICS.md'].map(path => {
  const result = spawnSync('/usr/bin/git', ['show', '4a0cbe7:' + path], { cwd: repo, timeout: 3000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0);
  const sha256 = hash(readFileSync(join(repo, path)));
  assert.equal(sha256, hash(result.stdout), 'immutable input changed: ' + path);
  return { path, sha256, referenceCommit: '4a0cbe7' };
});
if (process.argv.includes('--check')) {
  const seal = json('MANIFEST.json');
  assert.deepEqual(inventory(), seal.files);
  assert.deepEqual(existing, seal.immutableInputs);
  console.log(`Evidence seal PASS: ${Object.keys(seal.files).length} owned files; source215; frozen312/1624; original11 failures and18 strict native mismatches preserved. No product rerun.`);
} else {
  writeFileSync(join(here, 'MANIFEST.json'), JSON.stringify({ sealedAt: new Date().toISOString(), identity: frozen.identity,
    freezeCommit: 'c7e7145', sourceCommit: source.commit, files: inventory(), immutableInputs: existing,
    authoritativeClassification: 'classification-v2.json', supersededButRetained: ['classification.json', 'preserved-ICU-profile.json'],
    proof: 'SOURCE_PROOF.md', verdicts: 'README.md', originalProductExitCode: 1,
    noProductRerun: true, noSourceChanges: true, noCanonicalEdits: true, noDelegation: true,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Sealed independent evidence without rerunning product cases.');
}
