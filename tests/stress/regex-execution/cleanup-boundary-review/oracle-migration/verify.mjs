import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
export const output = resolve(owned, 'oracle-migration');
export const snapshot = resolve(owned, '.temporary/runtime-r1-verified');
const runtime = '1b133a8662a32ee84524794842074c9c98d5f6c3';
const prior = 'c3a3647';
const fixtureCommit = '8d0909ff3cf29290051e3d91dc3205e629ef6bda';
const fixturePath = 'tests/stress/regex-execution/cleanup-boundary-review/runtime.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const frozenBytes = async (path, commit) => {
  const bytes = await readFile(path);
  assert.deepEqual(bytes, git('show', `${commit}:${path}`), path);
  return bytes;
};
const manifestPaths = ['freeze', 'build'].map(kind => `tests/stress/regex-execution/cleanup-boundary-review/evidence/runtime-r1-verified-${kind}.json`);
const manifests = await Promise.all(manifestPaths.map(path => frozenBytes(path, prior)));
export const freeze = JSON.parse(manifests[0]);
export const build = JSON.parse(manifests[1]);
assert.equal(freeze.commit, runtime);
assert.equal(freeze.mode, 'runtime-handoff');
assert.equal(build.sourceCommit, runtime);
assert.equal(build.status, 0);
assert.equal(freeze.identities.length, 216);
assert.equal(build.emitted.length, 704);
for (const entry of freeze.identities) {
  assert.equal(entry.commit, runtime);
  assert.equal(hash(git('show', `${runtime}:${entry.path}`)), entry.sha256, entry.path);
}
for (const entry of [...freeze.identities, ...build.emitted]) {
  assert.equal(hash(await readFile(resolve(snapshot, entry.path))), entry.sha256, entry.path);
}
const composition = [];
for (const [commit, paths] of [
  ['01aa1bffe0568cc6787d5ff8e0331e024a787385', ['src/commands/grep.ts', 'src/commands/search/rg.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/README.md']],
  ['10273352f8d65d929cbf5a23e69119414dacee60', ['tests/commands/regex-execution/followup/messageerror.test.ts']],
  ['07acb1a4d30b7592cf247a0220250317be4e2038', ['src/contracts/command.ts', 'src/contracts/command.md']],
]) {
  for (const path of paths) {
    const bytes = git('show', `${commit}:${path}`);
    assert.deepEqual(bytes, git('show', `${runtime}:${path}`), path);
    composition.push({ commit, path, sha256: hash(bytes), identicalAtRuntime: true });
  }
}
const originalFreezeBytes = await readFile(resolve(output, 'original-freeze.json'));
const original = JSON.parse(originalFreezeBytes);
const originalBytes = await readFile(resolve(output, 'original-runtime.mjs.txt'));
assert.equal(hash(originalBytes), original.originalSha256);
assert.deepEqual(originalBytes, git('show', `${original.originalCommit}:${fixturePath}`));
for (const entry of original.preserved) assert.equal(hash(await readFile(entry.path)), entry.sha256, entry.path);
const fixtureBytes = await frozenBytes(fixturePath, fixtureCommit);
assert.equal((fixtureBytes.toString().match(/^await check\(/gm) ?? []).length, 9);
const prepared = [];
for (const name of ['guard.mjs', 'runtime-r1-observer.mjs']) {
  const path = `tests/stress/regex-execution/cleanup-boundary-review/${name}`;
  prepared.push({ path, sha256: hash(await frozenBytes(path, prior)) });
}
export const verification = {
  time: new Date().toISOString(), runtime, fixtureCommit,
  fixtureCorrectionCommit: '5a93969794e749db31b636dc90ecf9a352c42242',
  fixtureSha256: hash(fixtureBytes), originalSha256: original.originalSha256,
  originalFreezeSha256: hash(originalFreezeBytes), preservedArtifacts: original.preserved.length,
  priorEvidenceCommit: git('rev-parse', prior).toString().trim(),
  sourceManifestSha256: hash(manifests[0]), buildManifestSha256: hash(manifests[1]),
  sourceFiles: freeze.identities.length, emittedFiles: build.emitted.length,
  snapshot, composition, prepared, node: process.version, platform: process.platform, arch: process.arch,
  fixtureGroups: 9, riskConsumed: 0, oldTwelve: 'historical; not rerun', additionalSix: 'UNUSED',
  oldFive: 'accepted historical compiled 5/5 and packed 5/5; not rerun',
  rebuild: false, method: 'reuse c3a3647 verified snapshot/build; immutable Git and all source/emitted hashes checked before execution; no live product source/dist',
};
