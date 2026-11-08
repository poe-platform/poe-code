import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(own, '../../../..');
const prefix = 'tests/commands/apply-patch-independent-20260828/admission-plan/';
const commit = process.argv[2];
assert.equal(process.argv.length, 3);
assert.equal(typeof commit, 'string');
assert.match(commit, /^[0-9a-f]{40}$/u);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ownBytes = name => readFileSync(path.join(own, name));
const expected = JSON.parse(ownBytes('DATA-EXPECTATIONS-v1.json'));
const inputs = JSON.parse(ownBytes('INPUTS-v1.json'));
let gitCalls = 0;
const git = args => {
  assert.ok(++gitCalls <= expected.limits.gitCalls);
  return execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], {
    cwd: root,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
    timeout: expected.limits.gitTimeoutMs,
    maxBuffer: expected.limits.gitCaptureBytes,
  });
};
function regular(filename, bound = expected.limits.inputFileBytes) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(realpathSync(filename), filename);
  assert.ok(stat.size <= bound);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return { bytes: bytes.length, mode: stat.mode & 0o777, sha256: digest(bytes) };
}
function ownCensus() {
  const names = readdirSync(own).sort();
  assert.deepEqual(names, [...expected.plannedFiles].sort());
  return names.map(name => ({ name, ...regular(path.join(own, name), 1024 * 1024) }));
}
function authenticateCurrent() {
  return [...inputs.current, ...inputs.tools].map(entry => {
    const filename = path.resolve(root, entry.path);
    assert.equal(filename, entry.resolvedPath);
    const observed = regular(filename);
    assert.deepEqual(observed, { bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256 });
    if (entry.storedAt) {
      assert.equal(entry.storedAt, inputs.preparationSnapshotCommit);
      assert.equal(entry.storedBytes, entry.bytes);
      assert.equal(entry.storedSha256, entry.sha256);
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(entry.gitTreeRecord);
      assert.ok(match);
      assert.equal(match[3], entry.path);
      assert.equal(entry.mode, match[1] === '100755' ? 0o755 : 0o644);
      const bytes = readFileSync(filename);
      assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'), match[2]);
    }
    return { path: entry.path, ...observed };
  });
}
const toolBefore = inputs.tools.map(entry => ({ path: entry.path, ...regular(path.resolve(root, entry.path)) }));
assert.equal(process.version, expected.runtimeExpected);
assert.equal(process.execPath, inputs.captureRuntime.executable);
assert.equal(toolBefore.find(entry => entry.path === process.execPath)?.sha256, expected.runtimeSha256);
assert.equal(toolBefore.find(entry => entry.path === '/usr/bin/git')?.sha256, inputs.tools.find(entry => entry.path === '/usr/bin/git')?.sha256);
const beforeOwn = ownCensus();
assert.equal(git(['cat-file', '-t', commit]).toString().trim(), 'commit');
const storedNames = git(['ls-tree', '-r', '--name-only', commit, '--', prefix]).toString().trim().split('\n');
assert.deepEqual(storedNames, [...expected.plannedFiles].sort().map(name => prefix + name));
for (const entry of beforeOwn) assert.equal(digest(git(['show', `${commit}:${prefix}${entry.name}`])), entry.sha256);
const currentBefore = authenticateCurrent();
assert.equal(git(['cat-file', '-t', inputs.preparationSnapshotCommit]).toString().trim(), 'commit');
const storedCurrent = git(['ls-tree', '-r', inputs.preparationSnapshotCommit, '--', ...inputs.current.map(entry => entry.path)]).toString().trim().split('\n');
assert.deepEqual(storedCurrent.sort(), inputs.current.map(entry => entry.gitTreeRecord).sort());
assert.equal(git(['cat-file', '-t', expected.authorCommit]).toString().trim(), 'commit');
let authorCases;
for (const entry of inputs.pinned) {
  assert.equal(entry.commit, expected.authorCommit);
  assert.ok(['PROFILE-PROPOSAL-v1.md', 'CASES-v1.json', 'DESIGN-CHECK-v1.json', 'SOURCES-v1.json'].includes(path.basename(entry.path)));
  const bytes = git(['show', `${entry.commit}:${entry.path}`]);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256);
  if (expected.authorInputHashes[path.basename(entry.path)]) assert.equal(entry.sha256, expected.authorInputHashes[path.basename(entry.path)]);
  if (entry.path.endsWith('/CASES-v1.json')) authorCases = JSON.parse(bytes);
}
assert.deepEqual(authorCases.literalCases.map(entry => entry.id), expected.authorIds);
assert.deepEqual(authorCases.adversarialFamilies.map(entry => entry.id), expected.authorFamilyIds);
const integration = JSON.parse(ownBytes('MATRIX-INTERFACE-v1.json'));
assert.deepEqual(integration.authorInput.ids, expected.authorIds);
assert.deepEqual(integration.authorInput.familyIds, expected.authorFamilyIds);
assert.deepEqual(integration.requiredExtraSlots.map(entry => entry.slot), expected.extraSlots);
assert.equal(integration.preparedStatus, 'NOT_RUN');
const mutations = JSON.parse(ownBytes('MUTATIONS-v1.json'));
assert.deepEqual(mutations.mutants.map(entry => entry.id), expected.mutationIds);
assert.equal(new Set(mutations.mutants.map(entry => entry.marker)).size, 18);
for (const entry of mutations.mutants) {
  assert.ok(entry.marker.startsWith(`AP-ADM-v1:${entry.id}:`));
  assert.ok(entry.violation.length > 0 && entry.route.length > 0);
}
assert.equal(mutations.moduleBindings, null);
assert.equal(mutations.executedMutations, 0);
const binding = JSON.parse(ownBytes('BINDING-v1.json'));
assert.ok(Object.values(binding.candidate).every(value => value === null));
assert.ok(Object.values(binding.authority).every(value => value === null));
assert.ok(Object.values(binding.execution).every(value => value === 0));
assert.deepEqual(authenticateCurrent(), currentBefore);
assert.deepEqual(ownCensus(), beforeOwn);
assert.deepEqual(inputs.tools.map(entry => ({ path: entry.path, ...regular(path.resolve(root, entry.path)) })), toolBefore);
process.stdout.write(JSON.stringify({
  schema: 'apply-patch-admission-data-result-v1',
  decision: expected.expectedDecision,
  presealCommit: commit,
  checkerSha256: digest(ownBytes('check-data.mjs')),
  expectationsSha256: digest(ownBytes('DATA-EXPECTATIONS-v1.json')),
  inputManifestSha256: digest(ownBytes('INPUTS-v1.json')),
  authenticatedCurrentInputs: inputs.current.length,
  authenticatedPinnedPreparationInputs: inputs.pinned.length,
  authenticatedToolEntries: inputs.tools.length,
  gitMetadataChildren: gitCalls,
  staticAuthorIds: expected.authorIds.length,
  staticFamilyIds: expected.authorFamilyIds.length,
  staticExtraCoverageSlots: expected.extraSlots.length,
  staticMutationIntents: expected.mutationIds.length,
  ownedTreeBeforeAfterIncludingAdditions: 'IDENTICAL_TO_PRESEAL_8_FILES',
  externalInputCheck: 'Enumerated bytes/modes only; not append-proof external repository/tool trees',
  candidateAndAuthorityFields: 'ALL_UNRESOLVED_NULL',
  productExecutions: 0,
  candidateInspections: 0,
  productImports: 0,
  builds: 0,
  typeCompilations: 0,
  installs: 0,
  nativeOrCodexOrComparatorExecutions: 0,
  syntheticRuntimeControls: 0,
  qualification: 'Static DATA authentication/shape checks only. No existing runner/helper loaded or executed; no dynamic limit, source/install/moved/type/mutant/cleanup acceptance. Git metadata subprocesses are developer tools, not product delegation.'
}, null, 2) + '\n');
