import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessCommittedRevision, verifyFreshCommittedArchive } from './committed-archive.mjs';
import { stageNative, verifyNativeStaging, digest } from '../preflight-repair/preflight.mjs';
import { prerequisites, privateState } from './prerequisites.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const policy = JSON.parse(readFileSync(join(here, 'policy.json')));
const environment = { ...process.env, TREE_NATIVE_BIN: '/tmp/safe-bash-tree-external-oracle-TbVJVK/tree' };
const admission = assessCommittedRevision({ repository, candidate: policy.candidate, profile: policy, environment });
assert.deepEqual(admission.issues, []); assert.equal(admission.native.assets.length, 49);
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-native-staging-regression-')));
const source = join(temporary, 'source'), nativeRoot = join(temporary, 'native'); mkdirSync(source); mkdirSync(nativeRoot);
const beforePrivate = privateState();
const report = { candidate: policy.candidate, startedAt: new Date().toISOString(), controls: [], native: admission.native.assets.length,
  productionExecutions: 0, compilerRuns: 0, wholeGateLaunched: false, privateBefore: beforePrivate };
const control = (name, action) => { action(); report.controls.push({ name, status: 'pass' }); };
try {
  const archive = join(temporary, 'source.tar');
  execFileSync('git', ['--no-replace-objects', 'archive', '--output', archive, policy.candidate], { cwd: repository, timeout: 120000 });
  execFileSync('tar', ['-xf', archive, '-C', source], { timeout: 120000 });
  const bound = verifyFreshCommittedArchive(source, admission.entries);
  report.archive = { count: bound.count, sha256: digest(readFileSync(archive)), manifestSha256: digest(JSON.stringify(bound.files)) };
  const observed = await prerequisites({ repository, source, temporary, environment, candidate: policy.candidate });
  const tarAsset = admission.native.assets.find(entry => entry.target === 'snapshot:tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar'); assert.ok(tarAsset);
  const target = join(source, tarAsset.target.slice('snapshot:'.length));
  control('actual prerequisite authority leaves tar publication to mandatory staging', () => assert.equal(existsSync(target), false));
  control('origin read-only profile retained', () => assert.equal(lstatSync(tarAsset.origin).mode & 0o777, 0o555));
  const staged = stageNative(admission, { snapshot: source, nativeRoot, environment }); verifyNativeStaging(staged);
  report.staged = staged;
  control('mandatory producer publishes exact read-only tar once', () => {
    assert.equal(digest(readFileSync(target)), tarAsset.sha256); assert.equal(lstatSync(target).mode & 0o777, 0o555);
    assert.ok(staged.some(entry => entry.target === target));
  });
  const original = readFileSync(target);
  writeFileSync(join(temporary, 'other-native'), 'different native bytes');
  const changed = { ...admission, native: { ...admission.native, assets: admission.native.assets.map(entry => entry === tarAsset ? { ...entry, origin: join(temporary, 'other-native') } : entry) } };
  control('changed origin remains a refusal before publication', () => assert.throws(() => stageNative(changed, { snapshot: source, nativeRoot, environment }), /changed after admission/u));
  control('rejected origin preserves staged tar', () => assert.deepEqual(readFileSync(target), original));
  chmodSync(target, 0o644);
  control('lost executable permission rejects', () => assert.throws(() => verifyNativeStaging(staged), /executable/u));
  chmodSync(target, 0o555);
  const archives = await import(pathToFileURL(join(source, 'tests/plugins/qualified-current-release/prerequisites.mjs')).href);
  rmSync(target);
  const mutantDirectory = join(temporary, 'mutant'); mkdirSync(mutantDirectory);
  archives.stageArchiveTar({ root: source, directory: mutantDirectory }, observed.native.archive);
  control('restored early publisher is detected by unchanged absent-target assertion', () => assert.throws(() => assert.equal(existsSync(target), false), { code: 'ERR_ASSERTION' }));
  let duplicateError;
  try { stageNative(admission, { snapshot: source, nativeRoot, environment }); }
  catch (error) { duplicateError = { code: error.code, message: error.message }; }
  control('actual old duplicate-writer sequence reproduces EACCES', () => assert.equal(duplicateError?.code, 'EACCES'));
  report.duplicateError = duplicateError;
  for (const [path, entry] of Object.entries(bound.files)) {
    const filename = join(source, path), stat = lstatSync(filename);
    if (!entry.symlink) assert.equal(digest(readFileSync(filename)), entry.sha256, `Candidate input changed: ${path}`);
    assert.equal(stat.mode & 0o777, entry.mode);
  }
  control('all archived tracked inputs retain bytes and modes', () => assert.ok(bound.count > 0));
  report.privateAfter = privateState(); assert.deepEqual(report.privateAfter, beforePrivate);
  for (const entry of observed.safejs.files) {
    const path = join(beforePrivate.root, 'packages/safejs', entry.path);
    assert.equal(digest(readFileSync(path)), entry.sha256); assert.equal(lstatSync(path).mode & 0o777, entry.mode);
  }
  report.privateUnchanged = true; report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ status: report.status, controls: report.controls.length, error: report.error, temporaryRemoved: report.temporaryRemoved, output }));
