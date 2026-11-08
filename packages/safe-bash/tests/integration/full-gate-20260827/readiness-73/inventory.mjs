import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = process.argv[2]; assert.ok(output);
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const text = args => git(args).toString().trim();
const snapshot = text(['rev-parse', 'HEAD']);
const baseline = '8670ebe8f0d39966c2de2638780437398e5f8490';
const blob = (revision, path) => git(['show', `${revision}:${path}`]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = revision => git(['ls-tree', '-r', '--name-only', '-z', revision]).toString().split('\0').filter(Boolean).sort();
const current = paths(snapshot), old = paths(baseline);
const canonical = files => files.filter(path => /^tests\/.*\.test\.ts$/.test(path) && !path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/'));
const currentCanonical = canonical(current), oldCanonical = canonical(old);
const difference = (left, right) => left.filter(path => !new Set(right).has(path));
const report = { at: new Date().toISOString(), snapshot, tree: text(['rev-parse', `${snapshot}^{tree}`]), baseline, suiteLaunched: false, productExecutions: 0, dirtyAtStart: text(['status', '--short']), committedPaths: current.length };
report.canonical = { count: currentCanonical.length, baselineCount: oldCanonical.length, added: difference(currentCanonical, oldCanonical), removed: difference(oldCanonical, currentCanonical), paths: currentCanonical };
report.sourceAndRootCommits = text(['log', '--format=%H%x09%s', `${baseline}..${snapshot}`, '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json']).split('\n').filter(Boolean).map(line => {
  const [commit, ...subject] = line.split('\t');
  return { commit, subject: subject.join('\t'), paths: text(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split('\n').filter(Boolean) };
});
report.sourceAndRootChanges = text(['diff', '--name-status', baseline, snapshot, '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json']).split('\n').filter(Boolean);
const checkpoints = [
  ['c27249c8', 'accepted-source', 'b8712221', 'direct rg iterator close'],
  ['04644bc2', 'accepted-source-prerequisite', '3ceac6f3', 'alias context forwarding; later public integration separately pending'],
  ['38cb670a', 'accepted-source-prerequisite', '491a98b9', 'column context/cleanup; root-relayed final source acceptance'],
  ['a8096354', 'accepted-source-prerequisite', '491a98b9', 'column padding profile; root-relayed acceptance'],
  ['3af3f628', 'accepted-source-prerequisite', '3ceac6f3', 'external stdin close errors'],
  ['f8819e9d', 'accepted-source-prerequisite', '18c02655', 'primary read failure takes precedence'],
  ['08a26051', 'accepted-source', '3fe952ea', 'unkeyed numeric cache; no wallclock claim'],
  ['b4fe4c78', 'accepted-source', 'b6b2e96a', 'guarded single numeric-key cache; no wallclock claim'],
  ['ea409a6b', 'qualified-source', '01cc25f9', 'env-S shebang profile; Linux argv model not kernel'],
  ['5ba1a0f3', 'accepted-fixture', 'ec4e264d', 'exact eight env-S expectation changes'],
  ['bb7f5972', 'accepted-source', '32debb6a', 'curl zero host redirect/retry counts'],
  ['a3febbee', 'accepted-source', '93355f81', 'provider-reported allocatedBytes; Linux execution unverified'],
  ['8991abc3', 'accepted-source', '8f19a9d5', 'allocation forwarding wrappers'],
  ['46abd879', 'accepted-fixture-hygiene', 'e3d8f7e', 'first two split default evidence writers'],
  ['79f11f15', 'accepted-fixture-hygiene', 'ee0c60ea', 'remaining three split writers'],
  ['8784a8fc', 'accepted-fixture', '579c3225', 'strings argv0 capture binding'],
  ['91d56dbe', 'accepted-fixture', '3c56e36c', 'exact approved compiler configuration expectations'],
  ['5f7fe5d7', 'accepted-fixture-hygiene', '819e4105', 'direct curl writer; determine ancestry, not assumed later'],
  ['6dc79cd5', 'accepted-external-harness', 'c7489e14', 'Node24 guarded gate runtime admission'],
  ['774644f9', 'accepted-external-harness-component', '8bd5baa7', 'actual consumer permission feature selection'],
  ['c800c899', 'accepted-external-harness', 'daf7ae4c', 'explicit TAP dispatch; old helper30 remains29/30'],
  ['6699804a', 'accepted-external-harness', '58130545', 'explicit immutable archive admission'],
  ['cb940da6', 'author-source-pending-independent-public-review', 'dbceec2b', '73 defaults/root exports; Meitner review active'],
  ['f1a90436', 'pending-independent-review', '633fc0c7', 'tree charset author; holdout freeze is not acceptance'],
  ['fe7083d9', 'pending-independent-review', '68e0d848', 'expr shared regex worker extension author'],
  ['877144ea', 'pending-independent-review-not-default', null, 'du author source/tests'],
  ['a61e63bc', 'temporary-overlay-only-not-production', 'ee8bc359', 'owned-output S1 zero-cap overlay preparation; not promotion'],
];
report.checkpoints = checkpoints.map(([short, status, review, scope]) => {
  const commit = text(['rev-parse', `${short}^{commit}`]);
  const ancestor = (base, tip) => { try { git(['merge-base', '--is-ancestor', base, tip]); return true; } catch { return false; } };
  return { short, commit, status, review, scope, inSnapshot: ancestor(commit, snapshot), alreadyIn8670: ancestor(commit, baseline), acceptanceBasis: 'root handoffs and referenced scoped evidence; not a new execution by this inventory' };
});
const packageMetadata = JSON.parse(blob(snapshot, 'package.json'));
report.package = { name: packageMetadata.name, version: packageMetadata.version, engines: packageMetadata.engines, dependencies: packageMetadata.dependencies ?? {}, exports: packageMetadata.exports, sha256: hash(blob(snapshot, 'package.json')) };
const registry = blob(snapshot, 'tests/plugins/agent-commands.test.ts').toString();
const expected = /const expected = \[([\s\S]*?)\n  \]\.sort\(\)/.exec(registry); assert.ok(expected);
const declaredNames = [...expected[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
report.registry = { declaredNames, count: declaredNames.length, unique: new Set(declaredNames).size, sourceIsSameAsAuthorWiring: blob(snapshot, 'src/plugins/index.ts').equals(blob('cb940da6', 'src/plugins/index.ts')), rootExportsSameAsAuthorWiring: blob(snapshot, 'src/index.ts').equals(blob('cb940da6', 'src/index.ts')), currentSnapshotExecuted: false };
const inventoryPath = 'tests/plugins/qualified-current-release/inventory.json';
const inventory = JSON.parse(blob(snapshot, inventoryPath)), actualMts = current.filter(path => path.endsWith('.mts'));
const listed = inventory.entries.map(entry => entry.path);
report.mts = { committedCount: actualMts.length, declaredCount: listed.length, unclassified: difference(actualMts, listed), absent: difference(listed, actualMts), hashMismatches: [] };
for (const entry of inventory.entries) {
  if (entry.classification !== 'current' && current.includes(entry.path) && hash(blob(snapshot, entry.path)) !== entry.sha256) report.mts.hashMismatches.push({ path: entry.path, kind: 'classified-noncurrent-input', classification: entry.classification });
  for (const evidence of entry.freeze?.evidence ?? []) if (!current.includes(evidence.path) || hash(blob(snapshot, evidence.path)) !== evidence.sha256) report.mts.hashMismatches.push({ path: evidence.path, kind: 'frozen-authentication-evidence', owner: entry.path });
}
function envelope(revision) {
  const configs = new Set();
  const visit = path => { if (configs.has(path)) return; configs.add(path); const config = JSON.parse(blob(revision, path)); if (config.extends) visit(posix.normalize(posix.join(posix.dirname(path), config.extends))); };
  visit('tsconfig.build.json');
  const selected = [...paths(revision).filter(path => path.startsWith('src/')), 'package.json', 'package-lock.json', ...configs, 'tests/shell/invocation-cleanup-public.test.ts', 'tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs', 'tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'].sort((left, right) => left.localeCompare(right));
  return { format: 'public-cleanup-committed-v1', revision, tree: text(['rev-parse', `${revision}^{tree}`]), files: Object.fromEntries(selected.map(path => [path, hash(blob(revision, path))])) };
}
const oldEnvelope = envelope(baseline), currentEnvelope = envelope(snapshot);
const recordedOld = JSON.parse(blob(snapshot, 'tests/integration/full-gate-20260827/combined-8670ebe8/cleanup-expected.json'));
assert.deepEqual(oldEnvelope, recordedOld);
report.cleanup = { historicalCount: Object.keys(oldEnvelope.files).length, currentCount: Object.keys(currentEnvelope.files).length, historicalSha256: hash(Buffer.from(JSON.stringify(oldEnvelope))), computedCurrentSha256: hash(Buffer.from(JSON.stringify(currentEnvelope))), unchangedInputCount: Object.keys(currentEnvelope.files).filter(path => currentEnvelope.files[path] === oldEnvelope.files[path]).length, added: difference(Object.keys(currentEnvelope.files), Object.keys(oldEnvelope.files)), removed: difference(Object.keys(oldEnvelope.files), Object.keys(currentEnvelope.files)), changed: Object.keys(currentEnvelope.files).filter(path => oldEnvelope.files[path] && oldEnvelope.files[path] !== currentEnvelope.files[path]), qualification: 'computed from explicit committed Git blobs for readiness only; not an approved execution envelope or source acceptance', envelope: currentEnvelope };
const preflightPath = 'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs';
const runtimePath = 'tests/integration/full-gate-20260827/runtime-profile-20260827/profile.mjs';
for (const path of [preflightPath, runtimePath]) assert.deepEqual(readFileSync(resolve(repository, path)), blob(snapshot, path));
const { assessNative } = await import(pathToFileURL(resolve(repository, preflightPath)).href);
const { inspectRuntime, gateProfile } = await import(pathToFileURL(resolve(repository, runtimePath)).href);
const policy = JSON.parse(blob(snapshot, 'tests/integration/full-gate-20260827/combined-8670ebe8/policy.json'));
const external = JSON.parse(blob(snapshot, 'tests/commands/filesystem-inspection-stress/tree/EXTERNAL-ARTIFACTS.json'));
const tree = external.artifacts.find(entry => entry.externalBasename === 'tree'); assert.ok(tree);
report.native = assessNative(policy.native, repository, { ...process.env, TREE_NATIVE_BIN: tree.externalPath });
report.native.policyCandidate = policy.candidate; report.native.suiteLaunched = false;
report.native.profilesExecuted = false; report.native.environment = { TREE_NATIVE_BIN: tree.externalPath };
const duProfile = JSON.parse(blob(snapshot, 'tests/commands/du/native-profile.json'));
report.additionalNative = [
  { name: 'expr', path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr', expected: 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c', requirement: 'canonical expr qualification throws if missing; C.UTF-8 behavioral prerequisite not executed here' },
  { name: 'du', path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du', expected: duProfile.binarySha256, requirement: 'live canonical du row explicitly skips if unavailable; frozen profile includes disclosed nonparity' },
].map(asset => {
  try { const actual = hash(readFileSync(resolve(repository, asset.path))); return { ...asset, actual, matched: actual === asset.expected, executed: false }; }
  catch (error) { return { ...asset, matched: false, error: String(error), executed: false }; }
});
report.writerSourceBindings = [
  ['46abd879', 'tests/commands/split/native-errors.test.ts'],
  ['46abd879', 'tests/commands/split/native.test.ts'],
  ['79f11f15', 'tests/commands/split/dangling-native.test.ts'],
  ['79f11f15', 'tests/commands/split/edge.test.ts'],
  ['79f11f15', 'tests/commands/split/stress.test.ts'],
  ['79f11f15', 'tests/commands/split/native-capture.ts'],
  ['5f7fe5d7', 'tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/direct-curl.test.ts'],
].map(([revision, path]) => ({ revision: text(['rev-parse', revision]), path, sha256: hash(blob(snapshot, path)), unchangedSinceAcceptedFix: blob(snapshot, path).equals(blob(revision, path)) }));
const consumersPath = 'tests/plugins/qualified-current-release/consumers.mjs';
assert.deepEqual(readFileSync(resolve(repository, consumersPath)), blob(snapshot, consumersPath));
const consumers = await import(pathToFileURL(resolve(repository, consumersPath)).href);
report.currentConsumerGroups = { strict: consumers.consumerGroups.length, runtime: consumers.consumerGroups.filter(group => group.runtime.length).length, negative: consumers.negativeGroups.length, groups: consumers.consumerGroups.map(group => ({ name: group.name, runtime: group.runtime, qualification: group.qualification })), executed: false };
report.runtime = inspectRuntime(gateProfile.executable);
report.runtime.guardFeatureProbeExecutedNow = false;
report.runtime.guardCurrentHash = hash(blob(snapshot, 'tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'));
report.runtime.guardExpectedHash = gateProfile.guardSha256;
report.runtime.typescriptCurrentHash = hash(readFileSync(resolve(repository, 'node_modules/typescript/lib/typescript.js')));
report.runtime.typescriptExpectedHash = gateProfile.typescriptSha256;
report.capturePolicyEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /(?:CAPTURE|PUBLIC_CLEANUP)/.test(key)));
report.headAtEnd = text(['rev-parse', 'HEAD']); report.dirtyAtEnd = text(['status', '--short']);
report.completedAt = new Date().toISOString();
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ snapshot, headAtEnd: report.headAtEnd, canonical: report.canonical.count, baselineCanonical: report.canonical.baselineCount, cleanup: report.cleanup.currentCount, oldCleanup: report.cleanup.historicalCount, mts: { committed: report.mts.committedCount, classified: report.mts.declaredCount, unknown: report.mts.unclassified, hashMismatches: report.mts.hashMismatches }, native: { matched: report.native.assets.length, issues: report.native.issues }, runtime: report.runtime.supported, output, suiteLaunched: false }));
