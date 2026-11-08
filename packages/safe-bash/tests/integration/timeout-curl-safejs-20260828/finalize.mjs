import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, read, hashFile, sha, save, inventory, privateState } from './common.mjs';

const result = read(join(own, 'RESULT.json')), binding = read(join(own, 'BINDINGS.json'));
assert.equal(result.classification, 'SCOPED_FINDINGS');
assert.equal(result.counts.installed.passed, 11); assert.equal(result.counts.moved.passed, 11);
const manifest = read(join(own, 'MANIFEST.json'));
assert.equal(hashFile(join(own, 'MANIFEST.json')), 'e6982d0beae85d14f1d6458e735f6ddac3eb0cea5e7178875cff75ee033cf331');
for (const row of manifest.files) assert.equal(hashFile(join(own, row.path)), row.sha256);
const rawManifest = read(join(own, 'RAW-MANIFEST.json'));
assert.equal(hashFile(join(own, 'RAW.json.gz')), rawManifest.sha256);
const archive = JSON.parse(gunzipSync(fs.readFileSync(join(own, 'RAW.json.gz')), { maxOutputLength: 32 * 1024 ** 2 }));
assert.equal(archive.rows.length, rawManifest.files);
for (const row of archive.rows) {
  const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
  assert.equal(hashFile(join(own, 'raw-01', row.path)), row.sha256);
}
assert.deepEqual(inventory(join(own, 'raw-01')).filter(row => row.kind === 'file'), rawManifest.rawInventory);
let assertions = 0, passed = 0, setup = 0, measured = 0;
const failures = [], closure = [];
for (const row of result.rows) {
  const raw = read(join(own, row.rawDirectory, 'RESULT.json'));
  assert.equal(hashFile(join(own, row.rawDirectory, 'RESULT.json')), row.resultSHA256);
  assertions += raw.assertions.length; passed += raw.assertions.filter(value => value.pass).length;
  setup += raw.setupExecutions; measured += raw.measuredExecutions;
  assert.equal(raw.clean, true); assert.ok(Object.values(raw.finalResources).every(value => value === 0));
  closure.push({ id: row.id, layout: row.layout, finalResources: raw.finalResources, engineRuns: raw.engineRuns, engineSettled: raw.engineSettled, bridgeEntered: raw.bridgeEntered, bridgeSettled: raw.bridgeSettled, outerSettlement: raw.events.filter(value => value.event === 'outer-settled') });
  if (row.classification !== 'PASS') {
    assert.equal(row.id, 'W05'); assert.equal(row.failures.length, 1); assert.equal(row.failures[0].name, 'PUBLIC_BOUNDARY');
    assert.equal(raw.observations[0].value.stderr, 'curl: (7) Network access denied by host policy\n');
    assert.equal(raw.observations[0].value.exitCode, 7); assert.equal(raw.observations[0].value.stdout, '');
    assert.ok(raw.assertions.find(value => value.name === 'DENIED_REDIRECT_NO_EXTRA_WORK')?.pass);
    failures.push({ id: row.id, layout: row.layout, originalClassification: row.classification, originalFailure: row.failures[0], actual: raw.observations[0].value, traffic: raw.traffic });
  }
}
assert.equal(failures.length, 2);
const view = join(own, 'node_modules/attempt-01/moved/deep/consumer');
const sharedPath = 'dist/commands/network/shared.js';
const emitted = fs.readFileSync(join(view, 'node_modules/virtual-bash', sharedPath));
assert.equal(sha(emitted), binding.package.files.entries.find(row => row.path === sharedPath).sha256);
const diagnosticLine = emitted.toString().split('\n').find(line => line.includes('encode(`curl: (${error.exitCode})'));
assert.equal(diagnosticLine, '    await writeBytes(context.stderr, encode(`curl: (${error.exitCode}) ${error.message}\\n`), context.signal);');
const postPrivate = privateState(); assert.deepEqual(postPrivate, result.privateBefore);
for (const child of result.children) {
  assert.equal(child.reaped, true); assert.equal(child.forced, false);
  for (const target of [child.pid, -child.pid]) { let caught; try { process.kill(target, 0); } catch (error) { caught = error; } assert.equal(caught?.code, 'ESRCH'); }
}
const review = {
  schema: 'timeout-curl-safejs-post-run-review-v1', reviewedAt: new Date().toISOString(), resultSHA256: hashFile(join(own, 'RESULT.json')),
  verdict: '11/12 installed and 11/12 moved qualify; W05 is a frozen verifier diagnostic-literal defect, not an established product defect. No rescore or replay.',
  originalCounts: result.counts, assertions: { passed, executed: assertions }, setupExecutions: setup, measuredExecutions: measured,
  nodeChildren: { total: result.children.length, natural: result.children.filter(row => row.reaped && !row.forced).length, status0: result.children.filter(row => row.close.code === 0).length, status1: result.children.filter(row => row.close.code === 1).length },
  gitChildren: { total: result.gitChildren.length, naturalStatus0: result.gitChildren.filter(row => row.reaped && row.status === 0 && !row.signal).length },
  guards: result.guards.length, allPrivateChecksPassed: true,
  actualLoads: { productNextLoad: result.rows.reduce((total, row) => total + row.actualProductLoadObservations, 0), engineTransformed: result.rows.reduce((total, row) => total + row.actualEngineLoadObservations, 0), compilerNextLoad: [...result.rows, ...result.controls].reduce((total, row) => total + row.actualCompilerLoadObservations, 0) },
  failures, diagnosticProof: { path: sharedPath, sha256: sha(emitted), exactLine: diagnosticLine }, closure,
  proposedOnly: { scope: 'W05 exact stderr literal only', old: 'curl: Network access denied by host policy\n', correctPinnedDiagnostic: 'curl: (7) Network access denied by host policy\n', action: 'Root may authorize a separately versioned W05-only predicate/continuation. No product patch or whole-cohort rerun is indicated by these observations.', executed: false },
  rawArchive: { sha256: rawManifest.sha256, bytes: rawManifest.bytes, files: rawManifest.files, allRowsVerified: true },
  limitations: ['Actual engine / injected HTTP mocks; no live network or credentials.', 'No guest-realm identity equivalence claim; observed host raw/outer identity only.', 'S1/dialect/rejection/zero-retry history retained; no old25 or public78 replay.', 'No native/SafeJS broad acceptance/fullgate/provider hard-preemption claim.', 'Initial progress message incorrectly said installed12/12 before final tally; corrected to11/12. Authoritative raw results were never modified.'],
};
save(join(own, 'REVIEW.json'), review);
console.log(JSON.stringify({ verdict: review.verdict, assertions: review.assertions, setup, measured, children: review.nodeChildren, git: review.gitChildren, loads: review.actualLoads, archive: review.rawArchive }));
