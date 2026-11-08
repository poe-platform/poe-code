import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, fsyncSync, writeSync, mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { owned, inventory, readJson, fileHash, authenticate, git } from './recipe/authenticate.mjs';

const recipeCommit = 'c308fc79ea1e0a5ff7fe8d3bdcc116aadc09825b';
const recipeSha = '8970bef9f5b58b1c094fc08f70924b3209c683cc5a8f9e6542af63c218579f8d';
function save(name, value) {
  const descriptor = openSync(join(owned, name), 'wx');
  try { writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
const raw = join(owned, 'raw');
const report = readJson(join(raw, 'READ-ONLY-POSTCHECK.json'));
const summary = readJson(join(raw, 'execution-01/SUMMARY.json'));
const launch = readJson(join(raw, 'LAUNCH-RESULT.json'));
const start = readJson(join(raw, 'LAUNCH-START.json'));
const settlement = readJson(join(raw, 'SETTLED.json'));
const pre = readJson(join(owned, 'recipe/PREFLIGHT.json'));
assert.equal(fileHash(join(owned, 'recipe/MANIFEST.json')), recipeSha);
const recipeManifest = readJson(join(owned, 'recipe/MANIFEST.json'));
for (const [path, identity] of Object.entries(recipeManifest.files)) assert.deepEqual(inventory(join(owned, 'recipe')).files[path], identity);
save('RESULT.json', {
  schema: 'independent-html-admission-v3.2-resource-result/1', at: new Date().toISOString(), recipeCommit, recipeManifestSha256: recipeSha,
  invocations: 1, retries: 0, resourceProfile: { declared: 5, executed: summary.controlsExecuted, expected: summary.expectedOutcomes, unexpected: summary.unexpectedFailures, unrun: summary.unexecuted },
  launch, start, settlement, postcheck: { passed: report.passed, failed: report.failed, controlReruns: 0 },
  measurements: report.measurements, staticOnlyAuthorClaims: pre.authorClaimsStaticOnly,
  acceptance: 'Qualified five-case fresh-process stream resource profile only. Negative controls remain failures with expected exact reasons/statuses.',
  limits: ['not whole-verifier RSS', 'instrumentation overhead is included', 'sampled current RSS, not continuous maximum', 'no historical RSS cause claim', 'hard-deadline unsafe fallback is not a universal reaping guarantee', 'fsync-completed file receipts, not directory/power-loss guarantees', 'PID/group absence snapshots are not identity leases'],
  metadataCorrectionsNoExecutionChange: [
    'Frozen recipe manifest syntaxCheckedModules says7; its files contain six .mjs modules and all six were syntax checked. This count typo remains in immutable recipe; no module omitted or case rerun.',
    'Frozen REVIEW launch paragraph orders original-binding authentication before exclusive lock. Actual sealed code creates lock first, then authenticates original bindings, then spawns the sole coordinator. Independent recipe authentication precedes lock. Both authentications precede every actual case.'
  ],
  unexecuted: { synthetic28: true, forwarding6: true, orderedSynthetic8: true, authorReadonly33: 'static authenticated, not reexecuted', htmlActual34: 0, fullBuild410: false, pack830: false, twoPathReconstruction: false, productPublicHTML74: false, DU: false },
  historicalHolds: ['d28083dd admission-v2 34/35 RSS HOLD; numerical RSS lost/unrecoverable', 'e579a96c diagnosis not old cause or rescore', 'all v2/v3/v3.1 failures unchanged; no composite old gate pass', 'missing original first raw rejection; separate synthetic capture remains synthetic; three author development failures retained', 'partial independent recipe bf72a1f9d0eaa843e1e3a33949993a7d4a338d96 unchanged/unrerun', 'HTML34 awaits root release; DU29 and A06/P03 remain held']
});
const rawInventory = inventory(raw);
save('RAW-INVENTORY.json', { at: new Date().toISOString(), rootInArchive: 'raw', ...rawInventory, scope: 'exact files and directories; no omitted raw evidence or observer journals' });
const scratch = join(owned, 'compact-check');
mkdirSync(scratch);
const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', LANG: 'C', COPYFILE_DISABLE: '1' };
assert.equal(realpathSync(pre.tools.tar.path), pre.tools.tar.realpath);
assert.equal(fileHash(pre.tools.tar.path), pre.tools.tar.sha256);
const commands = [];
function tar(args) {
  const result = spawnSync(pre.tools.tar.path, args, { cwd: owned, env, encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, timeout: 30000 });
  commands.push({ executable: pre.tools.tar.path, realpath: pre.tools.tar.realpath, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0 || result.signal || result.error) { save('COMPACTION-FAILURE.json', { commands, controlReruns: 0 }); throw new Error('COMPACTION_FAILED; preserve raw and do not rerun controls'); }
  return result.stdout;
}
const archive = join(owned, 'captures.tgz');
assert.equal(existsSync(archive), false);
tar(['-czf', archive, '-C', owned, 'raw']);
const descriptor = openSync(archive, 'r');
fsyncSync(descriptor); closeSync(descriptor);
const archiveSha = fileHash(archive);
const entries = tar(['-tzf', archive]).trim().split('\n');
assert.ok(entries.every(path => path === 'raw/' || path.startsWith('raw/') && !path.split('/').includes('..')));
tar(['-xzf', archive, '-C', scratch]);
assert.deepEqual(inventory(join(scratch, 'raw')), rawInventory);
assert.deepEqual(inventory(raw), rawInventory);
assert.equal(fileHash(archive), archiveSha);
rmSync(scratch, { recursive: true });
rmSync(raw, { recursive: true });
assert.equal(existsSync(scratch), false);
assert.equal(existsSync(raw), false);
save('COMPACTION.json', { at: new Date().toISOString(), commands, archiveSha256: archiveSha, files: Object.keys(rawInventory.files).length, directories: rawInventory.directories.length, archiveEntries: entries.length, exactExtractedInventoryVerified: true, originalRawUnchangedBeforeRemoval: true, rawAndExtractedScratchRemoved: true, tarToolAliasNotBuildSymlink: pre.tools.tar, fileFsyncBeforeRemoval: true, controlReruns: 0 });
const post = await authenticate();
assert.deepEqual(post.tools, pre.tools);
const recipeCurrent = inventory(join(owned, 'recipe'));
assert.deepEqual(Object.keys(recipeCurrent.files).sort(), [...Object.keys(recipeManifest.files), 'MANIFEST.json'].sort());
for (const [path, identity] of Object.entries(recipeManifest.files)) assert.deepEqual(recipeCurrent.files[path], identity);
assert.equal(fileHash(join(owned, 'recipe/MANIFEST.json')), recipeSha);
save('FINAL-AUTH.json', post);
const pidProbe = settlement.spawnedSubjects;
assert.equal(pidProbe, 11);
save('CLEANUP.json', { at: new Date().toISOString(), rawPresent: existsSync(raw), compactScratchPresent: existsSync(scratch), originalRuntimeOwnedProcesses: settlement.spawnedSubjects, beforeFinalSettlement: { allObservedChildrenExitedAndClosed: settlement.allObservedChildrenExitedAndClosed, ownedGroupsEmpty: settlement.ownedGroupsEmpty }, awaitedSynchronousCompactionHelpers: commands.map(command => ({ executable: command.executable, status: command.status, signal: command.signal })), noResidualOwnedScratch: true, noAdditionalCaseExecution: true });
const envelope = inventory(owned);
save('EVIDENCE-MANIFEST.json', { schema: 'independent-html-admission-v3.2-resource-evidence/1', at: new Date().toISOString(), recipeCommit, recipeManifestSha256: recipeSha, files: envelope.files, directories: envelope.directories, coveredFiles: Object.keys(envelope.files).length, filesIncludingManifest: Object.keys(envelope.files).length + 1, archiveSha256: archiveSha, actualCases: summary.controlsExecuted, expected: summary.expectedOutcomes, unexpected: summary.unexpectedFailures, unrun: summary.unexecuted, postcheckPassed: report.passed, postcheckFailed: report.failed, exactEnvelopeInventory: true, protectedOriginalFiles: 176, preservedPriorFiles: 78, scope: 'new five-case stream component evidence only; no HTML acceptance or historical rescore' });
const sealed = readJson(join(owned, 'EVIDENCE-MANIFEST.json'));
const actual = inventory(owned);
assert.deepEqual(Object.keys(actual.files).sort(), [...Object.keys(sealed.files), 'EVIDENCE-MANIFEST.json'].sort());
assert.deepEqual(actual.directories, sealed.directories);
for (const [path, identity] of Object.entries(sealed.files)) assert.deepEqual(actual.files[path], identity, path);
console.log(JSON.stringify({ evidenceManifestSha256: fileHash(join(owned, 'EVIDENCE-MANIFEST.json')), archiveSha256: archiveSha, envelopeFiles: Object.keys(actual.files).length, capturedFiles: Object.keys(rawInventory.files).length, postcheckPassed: report.passed, postcheckFailed: report.failed, cleanup: true }));
