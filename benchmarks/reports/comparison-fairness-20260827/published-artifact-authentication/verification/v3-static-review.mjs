import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const auth = path.dirname(own);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename));
const names = ['supervise-representative.mjs', 'representative.mjs', 'launch-seal.mjs', 'driver-lifecycle.mjs', 'observe-process.mjs', 'observe-load.mjs', 'representative-plan-v3.json', 'execution-closure.json', 'download.json', 'package-comparison.json'];
const capture = () => Object.fromEntries(names.map(name => {
  const file = path.join(auth, name), stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink());
  return [name, { sha256: hash(fs.readFileSync(file)), bytes: stat.size, mode: stat.mode & 0o777 }];
}));
const before = capture();
const report = { kind: 'V3_OFFLINE_HASH_AND_SELECTION_REVIEW', startedAt: new Date().toISOString(), productExecutions: 0, authorModuleImports: 0, helperExecutions: 0, networkRequests: 0, before, blockers: [] };
try {
  const plan = read(path.join(auth, 'representative-plan-v3.json'));
  const prior = read(path.join(auth, 'representative-plan-v2.json'));
  const text = fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt');
  assert.equal(hash(text), plan.textPlanSha256);
  assert.deepEqual(plan.rows, prior.rows);
  assert.equal(plan.rows.length, 8);
  assert.equal(new Set(plan.rows.map(row => row.id)).size, 7);
  assert.deepEqual(plan.rows.map(row => row.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plan.budget.resultBearingBashExecCalls, 8);
  assert.equal(plan.budget.freshEngineChildren, 8);
  assert.equal(plan.budget.supervisorProcesses, 1);
  assert.equal(plan.budget.coordinatorProcesses, 1);
  assert.equal(plan.budget.maxConcurrentOsProcesses, 3);
  assert.equal(plan.budget.totalNodeProcesses, 10);
  for (const key of ['warmups', 'neutralityCalls', 'transportControls', 'inventoryConstructions', 'oursInitializationCalls', 'retries']) assert.equal(plan.budget[key], 0);
  assert.deepEqual([plan.budget.coordinatorSoftMs, plan.budget.supervisorTermMs, plan.budget.supervisorKillMs, plan.budget.supervisorFinalizeMs], [140000, 146000, 148000, 150000]);
  const preserved = read(path.join(auth, 'prior-candidate-v2/preservation.json'));
  for (const entry of preserved.entries) {
    const bytes = fs.readFileSync(path.join(auth, entry.priorCopy));
    assert.equal(hash(bytes), entry.sha256);
    assert.equal(bytes.length, entry.bytes);
  }
  const oldReview = preserved.entries.find(entry => entry.priorCopy === 'prior-candidate-v2/PREFLIGHT.md');
  assert.equal(hash(fs.readFileSync(path.join(own, 'PREFLIGHT.md'))), oldReview.sha256);
  const oldDetail = preserved.entries.find(entry => entry.priorCopy === 'prior-candidate-v2/preflight-detail.txt');
  assert.equal(hash(fs.readFileSync('/tmp/safe-bash-baseline-auth-preflight-detail.txt')), oldDetail.sha256);
  const closure = read(path.join(auth, 'execution-closure.json'));
  assert.equal(fs.realpathSync(closure.root), closure.root);
  assert.match(closure.root, /^\/private\/tmp\/safe-bash-published-auth-[^/]+\/execution-closure$/u);
  const observed = [];
  const directories = new Set();
  const expected = new Map(closure.files.map(entry => [entry.path, entry]));
  assert.equal(expected.size, 3842);
  for (const entry of closure.files) {
    let parent = path.posix.dirname(entry.path);
    while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  const authenticated = read(path.join(own, 'package-preflight-attempt-2.json'));
  assert.equal(authenticated.status, 'PUBLISHED_BYTES_MATCH_FROZEN_PACKAGE_EXECUTION_REVIEW_PENDING');
  let packageFiles = 0, bytes = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name), relative = path.relative(closure.root, filename);
      const stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { assert.ok(directories.has(relative), `extra directory: ${relative}`); walk(filename); }
      else {
        assert.ok(stat.isFile() && stat.nlink === 1);
        const wanted = expected.get(relative);
        assert.ok(wanted, `extra file: ${relative}`);
        const content = fs.readFileSync(filename);
        assert.equal(hash(content), wanted.sha256);
        assert.equal(stat.mode & 0o777, wanted.mode);
        assert.equal(content.length, wanted.bytes);
        observed.push(relative); bytes += content.length;
        if (relative.startsWith('benchmarks/node_modules/just-bash/')) {
          const member = relative.slice('benchmarks/node_modules/just-bash/'.length);
          assert.equal(hash(content), authenticated.package.published[member]?.sha256);
          packageFiles++;
        }
      }
    }
  }
  walk(closure.root);
  assert.deepEqual(observed.sort(), [...expected.keys()].sort());
  assert.equal(packageFiles, 955);
  assert.equal(bytes, closure.totalBytes);
  assert.equal(plan.closureAdditions.length, 2);
  assert.deepEqual(plan.closureAdditions, ['observe-process.mjs', 'observe-load.mjs'].map(name => ({ path: `auth-observer/${name}`, source: name, sha256: before[name].sha256, bytes: before[name].bytes, mode: 0o444 })));
  assert.equal(fs.existsSync(path.join(closure.root, 'auth-observer')), false, 'observer staging must be pending execution');
  const download = read(path.join(auth, 'download.json'));
  assert.equal(fs.realpathSync(download.executable), download.executable);
  assert.equal(hash(fs.readFileSync(download.executable)), download.nodeSha256);
  assert.equal(hash(fs.readFileSync(download.officialTarball.path)), authenticated.tarball.sha256);
  assert.equal(hash(fs.readFileSync(path.join(auth, 'registry-metadata.raw.json'))), authenticated.tarball.metadataSha256);
  for (const name of ['HOME', 'TMPDIR', 'npm_config_cache']) assert.ok(fs.realpathSync(download.environment[name]).startsWith(download.scratch + '/'));
  const helper = read(path.join(auth, 'driver-fix-checks-attempt-2.json'));
  const helperResult = helper.records.find(entry => entry.kind === 'non-product-helper-only');
  assert.equal(helperResult.status, 0);
  const cases = JSON.parse(helperResult.stdout);
  assert.equal(cases.pass, true);
  assert.equal(cases.cases.length, 8);
  assert.ok(cases.cases.every(entry => entry.pass));
  for (const name of ['launch-seal.mjs', 'driver-lifecycle.mjs', 'observe-process.mjs', 'observe-load.mjs']) assert.equal(helper.records.find(entry => entry.name === name)?.sha256, before[name].sha256);
  const finalSyntax = read(path.join(auth, 'driver-fix-checks-attempt-3.json'));
  for (const entry of finalSyntax.records) { assert.equal(entry.status, 0); assert.equal(before[entry.name].sha256, entry.sha256); }
  assert.equal(fs.existsSync(path.join(auth, 'representative-v3-attempt-001')), false, 'no product attempt expected during preflight');
  const after = capture();
  assert.deepEqual(after, before);
  assert.equal(hash(fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt')), plan.textPlanSha256);
  report.after = after;
  report.textPlanSha256 = plan.textPlanSha256;
  report.preservedHistoryEntries = preserved.entries.length;
  report.closure = { filesBeforeStaging: observed.length, bytes, authenticatedPackageFiles: packageFiles, observerAdditions: plan.closureAdditions, expectedFilesAfterStaging: observed.length + 2 };
  report.budget = plan.budget;
  report.rows = plan.rows.map(row => ({ sequence: row.sequence, profile: row.profile, id: row.id, recipeSha256: row.recipeSha256, oldBaselineStatus: row.oldBaselineStatus }));
  report.launch = { executable: download.executable, nodeSha256: download.nodeSha256, environment: download.environment };
  report.authorChecks = { helperCases: cases.cases, helperProductCalls: cases.productCalls, finalSyntaxFiles: finalSyntax.records.map(entry => entry.name), limitation: 'Read retained author evidence; this verifier did not import or execute these helpers.' };
  report.result = 'STATIC_V3_IDENTITIES_PASS_CONDITIONAL_REVIEW_NOT_ROOT_APPROVAL';
} catch (error) {
  report.result = 'BLOCKED';
  report.blockers.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
assert.equal(process.argv[2], '--out');
const target = path.resolve(process.argv[3]);
assert.ok(target.startsWith(own + '/'));
fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
