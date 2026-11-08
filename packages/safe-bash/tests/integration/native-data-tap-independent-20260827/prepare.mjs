import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { digest, fixture, git, inventory, json, node22, node24, npmCli, npmRoot, owned, policy, repository, selected, toolIdentity, tooling, version } from './common.mjs';

const parent = git('rev-parse', `${policy.candidate}^`).toString().trim();
assert.deepEqual(git('diff', '--name-only', parent, policy.candidate).toString().trim().split('\n'), [fixture]);
const before = git('show', `${parent}:${fixture}`).toString();
const after = git('show', `${policy.candidate}:${fixture}`).toString();
assert.equal(after, before.replace('run(copy.directory, "npm", ["test"]);', 'run(copy.directory, "npm", ["test", "--", "--test-reporter=tap"]);')
  .replace('test: original.before.testScript }', 'test: original.before.testScript.replace("--test ", "--test --test-reporter=tap ") }'));
const inputs = selected.map(path => {
  const bytes = git('show', `${policy.candidate}:${path}`);
  return { path, bytes: bytes.length, sha256: digest(bytes), blob: git('rev-parse', `${policy.candidate}:${path}`).toString().trim(), unchangedFromParent: bytes.equals(git('show', `${parent}:${path}`)) };
});
const authorPrefix = 'tests/integration/native-data-tap-author-20260827';
const authorManifestBytes = git('show', `${policy.authorEvidence}:${authorPrefix}/evidence-v1/MANIFEST.json`);
const authorManifest = JSON.parse(authorManifestBytes);
const authorRaw = git('show', `${policy.authorEvidence}:${authorPrefix}/evidence-v1/RAW.json.gz.base64`);
const authorCompressed = Buffer.from(authorRaw.toString().trim(), 'base64'), authorPayload = gunzipSync(authorCompressed);
assert.equal(digest(authorCompressed), authorManifest.compressedSha256);
assert.equal(digest(authorPayload), authorManifest.payloadSha256);
assert.equal(authorPayload.length, authorManifest.payloadBytes);
const decoded = new Map();
for (const [index, entry] of JSON.parse(authorPayload).entries.entries()) {
  const { base64, ...metadata } = entry, bytes = Buffer.from(base64, 'base64');
  assert.deepEqual(metadata, authorManifest.entries[index]);
  assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
  assert.equal(decoded.has(entry.name), false); decoded.set(entry.name, bytes);
}
assert.equal(decoded.size, authorManifest.entries.length);
const authorReport = JSON.parse(decoded.get('final/REPORT.json'));
assert.equal(authorReport.candidate, policy.candidate);
assert.equal(authorReport.fixtureMapping.afterSha256, digest(Buffer.from(after)));
const tools = [node22, node24, npmCli, join(tooling, 'typescript/lib/_tsc.js'), join(tooling, 'tsx/package.json')].map(toolIdentity);
for (const authorTool of authorReport.tools) assert.equal(toolIdentity(authorTool.path).sha256, authorTool.sha256);
const runtimeVersions = [node22, node24].map(path => ({ ...toolIdentity(path), version: version(path), npmVersion: version(path, [npmCli, '--version']) }));
assert.deepEqual(runtimeVersions.map(entry => entry.version), ['v22.22.2', 'v24.11.1']);
const lock = JSON.parse(git('show', `${policy.candidate}:package-lock.json`));
const installedLock = JSON.parse(readFileSync(join(tooling, '.package-lock.json')));
const membership = Object.entries(installedLock.packages).map(([path, entry]) => {
  assert.equal(entry.version, lock.packages[path].version, path);
  assert.equal(entry.integrity, lock.packages[path].integrity, path);
  assert.equal(entry.resolved, lock.packages[path].resolved, path);
  const packagePath = join(repository, path, 'package.json'), metadata = JSON.parse(readFileSync(packagePath));
  assert.equal(metadata.version, entry.version, path);
  return { path, version: entry.version, resolved: entry.resolved, integrity: entry.integrity, metadata: toolIdentity(packagePath) };
});
const toolInventories = { tooling: inventory(tooling), npm: inventory(npmRoot) };
const toolPayload = Buffer.from(JSON.stringify(toolInventories) + '\n');
writeFileSync(join(owned, 'preexecution-tooling.json.gz'), gzipSync(toolPayload, { level: 9 }), { flag: 'wx' });
const staged = JSON.parse(git('show', `${policy.candidate}:tests/plugins/qualified-current-release/staged-types.json`));
const stagedInputs = staged.entries.map(({ path, role }) => {
  const bytes = git('show', `${policy.candidate}:${path}`);
  assert.ok(bytes.equals(git('show', `${parent}:${path}`)));
  return { path, role, sha256: digest(bytes), unchangedFromParent: true };
});
const priorPath = 'tests/integration/du-type-workflow-independent-20260827/receipts/commands/unchanged-canonical-fixture-node24.json.gz';
const priorBytes = git('show', `${policy.priorIndependent}:${priorPath}`), prior = JSON.parse(gunzipSync(priorBytes));
const priorText = JSON.stringify(prior);
assert.match(priorText, /# pass 7/); assert.match(priorText, /# fail 1/);
const currentPackage = JSON.parse(git('show', `${policy.candidate}:package.json`));
const historical = JSON.parse(git('show', `${policy.candidate}:tests/plugins/qualified-current-release-native-data/before-02.json`));
const review = {
  preparedAt: new Date().toISOString(), cwd: realpathSync(repository), candidate: policy.candidate, parent,
  tree: git('rev-parse', `${policy.candidate}^{tree}`).toString().trim(),
  initialHead: git('rev-parse', 'HEAD').toString().trim(), initialStatus: git('status', '--short').toString(), initialIndex: git('diff', '--cached', '--name-status').toString(),
  exactDelta: git('diff', parent, policy.candidate, '--', fixture).toString(),
  minimality: 'Only the two exact reporter argv replacements; all other tracked paths, assertions, expected bytes, statuses, synthetic fixture strings and fourteen staged originals unchanged.',
  fixture: { path: fixture, beforeSha256: digest(Buffer.from(before)), sha256: digest(Buffer.from(after)), names: [...after.matchAll(/^test\("([^"]+)"/gmu)].map(match => match[1]) },
  dependencyClosure: '13 actual fixture reads/imports plus package-lock.json for tooling binding, not full committed tree. No product source runtime imported. consumers.mjs imports nothing; four current TS consumer files are read for nonempty presence only.',
  inputs, stagedInputs, scripts: { candidate: currentPackage.scripts, historicalTest: historical.before.testScript, liveEqualsCandidate: readFileSync(join(repository, 'package.json')).equals(git('show', `${policy.candidate}:package.json`)) },
  assertions: { filtered: ['status === 0', '/# tests 5\\b/u', '/# pass 5\\b/u', 'canonical-test-and-helper and neighbor-0..3', 'no NATIVE_DATA_MUST_NOT_EXECUTE'], historical: ['status === 1', 'NATIVE_DATA_MUST_NOT_EXECUTE', '/# tests 7\\b/u', '/# fail 2\\b/u'], diagnosticBytes: 'Original TS2322/TS2304 exact diagnostic arrays retained, not normalized or relaxed' },
  author: { commit: policy.authorEvidence, manifestSha256: digest(authorManifestBytes), rawFileSha256: digest(authorRaw), authenticatedEntries: decoded.size, toolsMatched: authorReport.tools, reportedCommandsNotIndependentScores: authorReport.commands, originalSetupFailureRetained: JSON.parse(decoded.get('setup-failed/REPORT.json')).status },
  prior: { commit: policy.priorIndependent, path: priorPath, sha256: digest(priorBytes), historicalNode24: '7/8; not rescored', receiptKeys: Object.keys(prior) },
  tools, runtimeVersions, membership, npm: { root: npmRoot, package: toolIdentity(join(npmRoot, 'package.json')), version: JSON.parse(readFileSync(join(npmRoot, 'package.json'))).version },
  toolInventories: { file: 'preexecution-tooling.json.gz', payloadSha256: digest(toolPayload), toolingEntries: toolInventories.tooling.length, npmEntries: toolInventories.npm.length },
  toolAuthenticationLimits: 'All installed dependency metadata checked against exact candidate lock, full bytes/membership frozen including additions. Lock integrity strings are provenance metadata, not reverified tarball digests. External Node/OS dynamic libraries not inventoried.',
  policySha256: digest(readFileSync(join(owned, 'policy.json'))), noFixtureTestsExecuted: true
};
assert.equal(review.fixture.names.length, 8);
json(join(owned, 'preexecution.json'), review);
console.log(JSON.stringify({ candidate: review.candidate, selectedInputs: inputs.length, tools: runtimeVersions, membership: membership.map(({ path, version }) => ({ path, version })), preexecution: true }));
