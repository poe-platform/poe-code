import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owned = 'tests/commands/structured-stress/jq-grammar-seal-proposal';
const target = 'tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts';
const oldPath = 'tests/commands/structured-stress/jq-42-review-fixes/immutable-before.json';
const planPath = 'tests/commands/structured-stress/jq-grammar-canonical-plan/patch-manifest-v3.json';
const auditPath = 'tests/commands/structured-stress/jq-grammar-final-review/final-audit.json';
const beforePath = `${owned}/before-2026-08-27/evidence.test.ts.txt`;
const afterPath = `${owned}/afterSnapshot/evidence.test.ts.txt`;
const approval = '95966ca2006bfa9bb35353cbac0a14038089c4ba';
const proposal = 'eab1d48a90456c1c2cdeb9289b32f1ed62429137';
const commits = {
  native: '50434b3646d3ba1711be5bb707d44d3bfa201fe2',
  host: '538a7f87ec50140780fa9a58f833e116d876e7c0',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(resolve(root, path));
const git = args => execFileSync('git', args, { cwd: root });
const oldBytes = read(oldPath);
const planBytes = read(planPath);
const old = JSON.parse(oldBytes);
const plan = JSON.parse(planBytes);
const audit = JSON.parse(read(auditPath));
assert.equal(sha256(oldBytes), '3766803b4bd8cc39f014e13de881cda034515b1094436530cdfa6505750ce9e3');
assert.equal(sha256(planBytes), 'aae89dfeefab84c50ef91a84c1c1608d659c0037ac96eb93c5f828ab32c938ce');
assert.equal(sha256(read(beforePath)), 'bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8');
assert.deepEqual(read(target), read(beforePath), 'proposal must remain unapplied');
assert.deepEqual(read(beforePath), git(['show', `${approval}:${target}`]));
assert.deepEqual(oldBytes, git(['show', `${approval}:${oldPath}`]));
assert.deepEqual(planBytes, git(['show', `${proposal}:${planPath}`]));
assert.deepEqual(planBytes, git(['show', `${approval}:${planPath}`]));
assert.deepEqual(read(auditPath), git(['show', `1d93186:${auditPath}`]));
assert.equal(plan.files.length, 13);
assert.equal(Object.keys(old.files).length, 139);
const migrations = plan.files.filter(file => Object.hasOwn(old.files, file.path));
assert.equal(migrations.length, 10);
assert.deepEqual(migrations.map(file => ({ path: file.path, oldHash: file.beforeSha256, actual: file.afterSha256 })).sort((left, right) => left.path.localeCompare(right.path)), audit.oldSeal.exactApprovedDeltas.toSorted((left, right) => left.path.localeCompare(right.path)));
for (const [kind, commit] of Object.entries(commits)) {
  git(['merge-base', '--is-ancestor', approval, commit]);
  const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).toString().trim().split('\n').sort();
  assert.deepEqual(paths, plan.files.filter(file => file.patch === kind).map(file => file.path).sort());
}
const pathMap = plan.files.map(file => {
  const commit = commits[file.patch];
  assert.ok(commit);
  assert.deepEqual(read(file.path), git(['show', `${commit}:${file.path}`]));
  assert.equal(sha256(read(file.path)), file.afterSha256);
  assert.equal(sha256(read(file.afterSnapshot)), file.afterSha256);
  assert.deepEqual(read(file.afterSnapshot), git(['show', `${approval}:${file.afterSnapshot}`]));
  if (file.beforeSnapshot !== null) {
    assert.equal(sha256(read(file.beforeSnapshot)), file.beforeSha256);
    assert.deepEqual(read(file.beforeSnapshot), git(['show', `${approval}:${file.beforeSnapshot}`]));
    assert.deepEqual(read(file.beforeSnapshot), git(['show', `${commit}^:${file.path}`]));
    assert.equal(file.beforeSha256, old.files[file.path]);
  } else {
    assert.equal(file.beforeSha256, null);
    assert.equal(git(['ls-tree', `${commit}^`, '--', file.path]).length, 0);
  }
  return { path: file.path, sealed: Object.hasOwn(old.files, file.path), commit, beforeSnapshot: file.beforeSnapshot, beforeSha256: file.beforeSha256, afterSnapshot: file.afterSnapshot, afterSha256: file.afterSha256 };
});

const patchCheck = spawnSync('git', ['apply', '--check', `${owned}/seal-migration.patch`], { cwd: root, encoding: 'utf8' });
assert.equal(patchCheck.status, 0, patchCheck.stderr);
const exactDiff = spawnSync('diff', ['-u', '-L', `a/${target}`, '-L', `b/${target}`, beforePath, afterPath], { cwd: root, encoding: 'utf8' });
assert.equal(exactDiff.status, 1, exactDiff.stderr);
assert.equal(read(`${owned}/seal-migration.patch`).toString(), exactDiff.stdout, 'patch yields exactly afterSnapshot');

const nativePath = 'tests/commands/structured-stress/jq-42-review-fixes/native-frozen.json';
const paths = new Set([oldPath, planPath, beforePath, nativePath, ...Object.keys(old.files)]);
for (const file of plan.files) {
  paths.add(file.path);
  paths.add(file.afterSnapshot);
  if (file.beforeSnapshot !== null) paths.add(file.beforeSnapshot);
}
const baseline = new Map([...paths].map(path => [path, read(path)]));
function executable(path) {
  const source = stripTypeScriptTypes(read(path).toString());
  assert.equal((source.match(/^import .*;$/gm) ?? []).length, 4);
  return source.replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'testUrl');
}
const candidate = executable(afterPath);
const original = executable(beforePath);
function run(source, files) {
  const names = [];
  runInNewContext(source, {
    assert, createHash, URL,
    testUrl: pathToFileURL(resolve(root, target)).href,
    readFileSync(path, encoding) {
      const key = relative(root, path instanceof URL ? fileURLToPath(path) : resolve(root, path));
      assert.ok(files.has(key), `missing virtual bytes: ${key}`);
      return encoding ? files.get(key).toString(encoding) : Buffer.from(files.get(key));
    },
    test(name, callback) { names.push(name); callback(); },
  }, { timeout: 1000 });
  assert.equal(names.length, 2, 'neither seal test is skipped');
  return names;
}
const names = run(candidate, baseline);
assert.throws(() => run(original, baseline), { code: 'ERR_ASSERTION' }, 'old live-before seal still fails');
const historical = new Map(baseline);
for (const file of migrations) historical.set(file.path, read(file.beforeSnapshot));
run(original, historical);
const results = [];
function reject(name, mutate) {
  const files = new Map(baseline);
  mutate(files);
  assert.throws(() => run(candidate, files), { code: 'ERR_ASSERTION' }, name);
  results.push({ name, rejected: true });
}
const tamper = (files, path) => files.set(path, Buffer.concat([files.get(path), Buffer.from('\nTAMPER')]));
for (const file of migrations) reject(`old-before tamper: ${file.path}`, files => tamper(files, file.beforeSnapshot));
for (const file of plan.files) {
  reject(`current-after tamper: ${file.path}`, files => tamper(files, file.path));
  reject(`after-snapshot tamper: ${file.path}`, files => tamper(files, file.afterSnapshot));
}
for (const path of Object.keys(old.files).filter(path => !migrations.some(file => file.path === path))) {
  reject(`unlisted sealed-path change: ${path}`, files => tamper(files, path));
}
function mutateJson(files, path, change) {
  const value = JSON.parse(files.get(path));
  change(value);
  files.set(path, Buffer.from(JSON.stringify(value)));
}
reject('migration missing entry', files => mutateJson(files, planPath, value => value.files.pop()));
reject('migration extra allowed path', files => mutateJson(files, planPath, value => value.files.push({ ...value.files[3], path: 'tests/unapproved.ts' })));
reject('migration duplicate entry', files => mutateJson(files, planPath, value => value.files.push(value.files[0])));
reject('migration changed before hash', files => mutateJson(files, planPath, value => { value.files[3].beforeSha256 = '0'.repeat(64); }));
reject('migration changed after hash', files => mutateJson(files, planPath, value => { value.files[3].afterSha256 = '0'.repeat(64); }));
reject('migration changed before snapshot path', files => mutateJson(files, planPath, value => { value.files[3].beforeSnapshot = value.files[4].beforeSnapshot; }));
reject('migration changed after snapshot path', files => mutateJson(files, planPath, value => { value.files[3].afterSnapshot = value.files[4].afterSnapshot; }));
reject('wrong manifest hash even with identical JSON meaning', files => files.set(planPath, Buffer.concat([files.get(planPath), Buffer.from('\n')])));
reject('old manifest removed entry', files => mutateJson(files, oldPath, value => { delete value.files[Object.keys(value.files)[0]]; }));
reject('old manifest extra entry', files => mutateJson(files, oldPath, value => { value.files['tests/unapproved.ts'] = '0'.repeat(64); }));
reject('old manifest changed original hash', files => mutateJson(files, oldPath, value => { value.files[migrations[0].path] = migrations[0].afterSha256; }));
reject('dated original seal test tamper', files => tamper(files, beforePath));
reject('nearby native frozen bytes tamper', files => tamper(files, nativePath));
for (const path of baseline.keys()) reject(`missing bytes: ${path}`, files => files.delete(path));

console.log(JSON.stringify({
  scope: 'UNAPPLIED TEST-ONLY historical seal migration; no product/native execution',
  target, approval, proposal, commits,
  oldManifest: { path: oldPath, sha256: sha256(oldBytes), entries: 139 },
  migrationManifest: { path: planPath, sha256: sha256(planBytes), entries: 13 },
  beforeSnapshot: { path: beforePath, sha256: sha256(read(beforePath)) },
  afterSnapshot: { path: afterPath, sha256: sha256(read(afterPath)) },
  patch: { path: `${owned}/seal-migration.patch`, sha256: sha256(read(`${owned}/seal-migration.patch`)), gitApplyCheck: true, exactSnapshotDiff: true },
  intersection: 10, unchangedSealedPaths: 129, newlyApprovedOutsideOldSeal: 3,
  pathMap,
  checks: { candidateTests: names.length, names, originalHistoricalTests: 2, originalLiveFailureRetained: true, rejectedMutations: results.length, totalChecks: 5 + results.length },
  mutations: results,
  historicalResult: '3757/3758 remains unchanged; full suite deliberately not rerun',
}, null, 2));
