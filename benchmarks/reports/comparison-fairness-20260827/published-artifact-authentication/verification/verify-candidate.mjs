import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safePath } from './tar-map.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const auth = dirname(own);
const repo = resolve(own, '../../../../..');
const read = async path => JSON.parse(await readFile(path));
const report = { kind: 'STATIC_REPRESENTATIVE_PREFLIGHT', productExecutions: 0, networkRequests: 0, candidateApproval: false, blockers: [] };
try {
  const before = await read(join(own, 'preflight-inputs-before.json'));
  const plan = await read(join(auth, 'representative-plan-v2.json'));
  const closure = await read(join(auth, 'execution-closure.json'));
  const published = await read(join(own, 'package-preflight-attempt-2.json'));
  assert.equal(published.status, 'PUBLISHED_BYTES_MATCH_FROZEN_PACKAGE_EXECUTION_REVIEW_PENDING');
  const frozen = await read(join(repo, 'benchmarks/reports/current-integration/comparison-replay-20260827/frozen-files.json'));
  const root = await realpath(closure.root);
  assert.match(root, /^\/private\/tmp\/safe-bash-published-auth-[^/]+\/execution-closure$/u);
  assert.equal(root, closure.root);
  assert.equal(closure.count, closure.files.length);
  assert.equal(new Set(closure.files.map(entry => entry.path)).size, closure.files.length);
  const observed = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `closure alias: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else { assert.ok(entry.isFile()); observed.push(relative(root, path)); }
    }
  }
  await walk(root);
  assert.deepEqual(observed.sort(), closure.files.map(entry => entry.path).sort(), 'execution closure membership');
  let authenticatedFiles = 0;
  let bytes = 0;
  for (const entry of closure.files) {
    safePath(entry.path);
    const path = join(root, entry.path);
    const metadata = await lstat(path);
    assert.equal(metadata.nlink, 1);
    assert.equal(metadata.mode & 0o777, entry.mode);
    const content = await readFile(path);
    assert.equal(content.length, entry.bytes);
    assert.equal(digest(content), entry.sha256);
    bytes += content.length;
    if (entry.path.startsWith('benchmarks/node_modules/just-bash/')) {
      const relativePackage = entry.path.slice('benchmarks/node_modules/just-bash/'.length);
      assert.equal(published.package.published[relativePackage]?.sha256, entry.sha256);
      authenticatedFiles++;
    } else assert.equal(frozen[entry.path]?.sha256, entry.sha256, `unapproved copied dependency/harness bytes: ${entry.path}`);
  }
  assert.equal(authenticatedFiles, 955);
  assert.equal(bytes, closure.totalBytes);
  const selected = [
    ['original', 'command/echo/multiple'],
    ['original', 'composition/archive-hash/archive-hash'],
    ['original', 'command/cat/binary-stdin'],
    ['original', 'network/curl/get'],
    ['original', 'network/curl/output'],
    ['original', 'kernel/type/type'],
    ['original', 'command/patch/dry-run'],
    ['scratch-aligned', 'command/patch/dry-run'],
  ];
  assert.deepEqual(plan.rows.map(row => [row.profile, row.id]), selected);
  assert.equal(plan.budget.resultBearingBashExecCalls, 8);
  assert.equal(plan.budget.freshEngineChildren, 8);
  assert.equal(plan.budget.distinctIds, 7);
  for (const field of ['warmups', 'neutralityCalls', 'transportControls', 'inventoryConstructions', 'oursInitializationCalls', 'retries']) assert.equal(plan.budget[field], 0);
  for (const [index, selection] of plan.rows.entries()) {
    const prefix = join(repo, 'benchmarks/reports/current-integration/comparison-replay-20260827', selection.profile);
    const cases = await read(join(prefix, 'case-inputs.json'));
    const recorded = await read(join(prefix, 'functional.json'));
    const recipe = cases.find(row => row.id === selection.id);
    const outcome = recorded.find(row => row.id === selection.id);
    assert.equal(selection.sequence, index + 1);
    assert.deepEqual(selection.recipe, recipe);
    assert.equal(selection.recipeSha256, digest(JSON.stringify(recipe)));
    assert.deepEqual(selection.expectedNative, outcome.expected);
    assert.equal(selection.oldBaselineStatus, outcome['just-bash'].status);
    assert.deepEqual(selection.oldBaselineFourFields, Object.fromEntries(['stdout', 'stderr', 'exitCode', 'entries'].map(field => [field, outcome['just-bash'].observation[field]])));
  }
  const download = await read(join(auth, 'download.json'));
  assert.equal(digest(await readFile(download.executable)), download.nodeSha256);
  for (const request of download.requests) {
    assert.equal(request.statusCode, 200);
    assert.equal(request.tls.authorized, true);
    assert.equal(request.tls.authorizationError, null);
    assert.equal(request.tls.servername, 'registry.npmjs.org');
    assert.equal(new URL(request.url).hostname, 'registry.npmjs.org');
    assert.equal(new URL(request.url).protocol, 'https:');
    assert.equal(new URL(request.url).username, '');
    assert.equal(new URL(request.url).password, '');
    assert.equal(request.requestHeaders.Authorization, undefined);
    assert.equal(request.requestHeaders.Cookie, undefined);
  }
  assert.equal(download.requests.length, 2);
  const after = {};
  const drift = [];
  for (const [name, entry] of Object.entries(before.files)) {
    const actual = digest(await readFile(join(auth, name)));
    after[name] = actual;
    if (actual !== entry.sha256) drift.push({ path: name, before: entry.sha256, after: actual });
  }
  const textPlanSha256 = digest(await readFile('/tmp/safe-bash-baseline-auth-plan.txt'));
  assert.equal(textPlanSha256, plan.textPlanSha256);
  report.inputDrift = drift;
  report.candidateHashesAfter = after;
  report.textPlanSha256 = textPlanSha256;
  report.executionClosure = { root, files: closure.files.length, bytes, authenticatedFiles, exactMembership: true, independentRegularFiles: true, sameFrozenOtherFiles: true };
  report.budget = plan.budget;
  report.selected = selected;
  report.nodeExecutable = { path: download.executable, sha256: download.nodeSha256 };
  report.tls = { exchanges: 2, authorized: true, interpretation: 'Captured HTTPS registry publication bytes match SRI/SHA1; not verification of package signatures or other dependency tarballs.' };
  report.status = drift.length ? 'CANDIDATE_DRIFT_REQUIRES_REVIEW' : 'STATIC_IDENTITIES_AND_SELECTION_PASS_HUMAN_PREFLIGHT_REQUIRED';
  if (drift.length) process.exitCode = 1;
} catch (error) {
  report.status = 'BLOCKED';
  report.blockers.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
}
assert.equal(process.argv[2], '--out');
const target = resolve(process.argv[3]);
assert.ok(target.startsWith(own + '/'));
await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
