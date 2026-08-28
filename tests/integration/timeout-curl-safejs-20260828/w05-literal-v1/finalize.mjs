import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own as originalOwn, read, save, sha, hashFile, inventory, privateState, gitReceipts } from '../common.mjs';
import { guardOriginal } from './verification.mjs';

const own = join(originalOwn, 'w05-literal-v1');
guardOriginal();
const result = read(join(own, 'RESULT.json')), original = read(join(originalOwn, 'RESULT.json'));
const oldReview = read(join(originalOwn, 'REVIEW.json'));
assert.equal(result.classification, 'SCOPED_PASS');
assert.deepEqual(result.rows.map(row => [row.layout, row.id, row.status]), [['installed', 'W05', 0], ['moved', 'W05', 0]]);
assert.equal(result.controls.length, 0); assert.equal(result.predicateControls.length, 4);
assert.ok(result.predicateControls.every(row => row.qualified));
assert.equal(original.counts.installed.passed, 11); assert.equal(original.counts.moved.passed, 11);
assert.deepEqual(oldReview.assertions, { passed: 116, executed: 118 });
const raw = join(own, 'raw-01'), work = join(own, 'node_modules/attempt-01');
const rawManifest = read(join(own, 'RAW-MANIFEST.json'));
assert.equal(hashFile(join(own, 'RAW.json.gz')), rawManifest.sha256);
const archive = JSON.parse(gunzipSync(fs.readFileSync(join(own, 'RAW.json.gz')), { maxOutputLength: 32 * 1024 ** 2 }));
assert.equal(archive.rows.length, rawManifest.files);
for (const row of archive.rows) { const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); assert.equal(hashFile(join(raw, row.path)), row.sha256); }
assert.deepEqual(inventory(raw).filter(row => row.kind === 'file'), rawManifest.rawInventory);
let assertions = 0, setup = 0, measured = 0;
const observations = [];
for (const row of result.rows) {
  const receipt = read(join(own, row.rawDirectory, 'RESULT.json'));
  assert.equal(hashFile(join(own, row.rawDirectory, 'RESULT.json')), row.resultSHA256);
  assert.equal(receipt.classification, 'PASS'); assert.equal(receipt.engineRuns, 0); assert.equal(receipt.clean, true);
  assert.equal(receipt.assertions.length, 5); assert.ok(receipt.assertions.every(row => row.pass));
  assert.ok(Object.values(receipt.finalResources).every(value => value === 0));
  assertions += receipt.assertions.length; setup += receipt.setupExecutions; measured += receipt.measuredExecutions;
  observations.push({ layout: row.layout, id: row.id, source: receipt.source, observations: receipt.observations, traffic: receipt.traffic, clock: receipt.clock, resources: receipt.finalResources, assertions: receipt.assertions });
}
for (const child of result.children) {
  assert.equal(child.reaped, true); assert.equal(child.forced, false); assert.deepEqual(child.exit, { code: 0, signal: null }); assert.deepEqual(child.close, child.exit);
  for (const target of [child.pid, -child.pid]) { let caught; try { process.kill(target, 0); } catch (error) { caught = error; } assert.equal(caught?.code, 'ESRCH'); }
}
const composition = ['installed', 'moved'].map(layout => {
  const retained = original.rows.filter(row => row.layout === layout && row.classification === 'PASS');
  assert.equal(retained.length, 11); assert.ok(retained.every(row => row.id !== 'W05'));
  return { layout, retained: retained.map(row => ({ id: row.id, resultSHA256: row.resultSHA256, evidenceCommit: '144e0fca945b40dc8f04cbd9d69fa6e23f770ac8' })), newlyQualified: [{ id: 'W05', resultSHA256: result.rows.find(row => row.layout === layout).resultSHA256 }], label: '11 retained + 1 new; composed qualification, not historical12/12 rescore' };
});
save(join(own, 'REVIEW.json'), {
  schema: 'W05-continuation-composed-review-v1', reviewedAt: new Date().toISOString(), verdict: 'SCOPED_COMPOSED_11_PLUS_1_EACH',
  resultSHA256: hashFile(join(own, 'RESULT.json')), originalResultSHA256: hashFile(join(originalOwn, 'RESULT.json')),
  originalEvidenceSHA256: hashFile(join(originalOwn, 'EVIDENCE-MANIFEST.json')), originalCounts: original.counts, originalAssertions: oldReview.assertions,
  newCounts: result.counts, newAssertions: { executed: assertions, passed: assertions }, setupExecutions: setup, measuredExecutions: measured,
  controls: { classes: 3, negatives: 4, qualified: 4, oldControlsReplayed: 0 },
  children: { naturalNode: result.children.length, naturalExecutionGit: result.gitChildren.filter(row => row.reaped && row.status === 0 && !row.signal).length },
  actualLoads: { productNextLoad: result.rows.reduce((total, row) => total + row.actualProductLoadObservations, 0), engineTransformed: result.rows.reduce((total, row) => total + row.actualEngineLoadObservations, 0), compilerNextLoad: result.rows.reduce((total, row) => total + row.actualCompilerLoadObservations, 0), engineEvaluations: 0 },
  composition, observations, archive: rawManifest,
  exclusions: ['Other11 workflows and original load/predicate controls not rerun.', 'Actual authenticated SafeJS module loads only; W05 performs no guest evaluation.', 'HTTP authorizer/transport deterministic injected mocks; no external network or credentials.', 'No native/provider/service/fullgate claim; historical S1/dialect/zero-retry qualifications intact.'],
});
const staged = read(join(raw, 'MATERIALIZED.json')), prefix = 'moved/deep/consumer', workRows = inventory(work);
assert.deepEqual(inventory(join(work, prefix)), staged);
assert.deepEqual(workRows.filter(row => !row.path.startsWith(prefix + '/')).map(row => ({ path: row.path, kind: row.kind })), [
  { path: 'installed', kind: 'directory' }, { path: 'moved', kind: 'directory' }, { path: 'moved/deep', kind: 'directory' }, { path: prefix, kind: 'directory' },
]);
const before = privateState(); assert.deepEqual(before, result.privateBefore);
fs.rmSync(raw, { recursive: true }); fs.rmSync(work, { recursive: true });
assert.equal(fs.existsSync(raw), false); assert.equal(fs.existsSync(work), false);
assert.deepEqual(privateState(), before); guardOriginal();
for (const row of read(join(own, 'MANIFEST.json')).files) assert.equal(hashFile(join(own, row.path)), row.sha256);
save(join(own, 'CLOSURE.json'), { at: new Date().toISOString(), rawFilesVerifiedRemoved: archive.rows.length, stagedEntriesVerifiedRemoved: workRows.length, privateUnchanged: true, originalFilesUnchanged: true, removedOnly: ['raw-01', 'node_modules/attempt-01'], postOnlyGitChildren: gitReceipts, productExecutions: 0 });
const files = fs.readdirSync(own).sort().filter(name => name !== 'node_modules' && name !== 'EVIDENCE-MANIFEST.json').map(path => {
  const target = join(own, path), stat = fs.lstatSync(target); assert.ok(stat.isFile() && !stat.isSymbolicLink()); return { path, bytes: stat.size, mode: stat.mode & 511, sha256: hashFile(target) };
});
save(join(own, 'EVIDENCE-MANIFEST.json'), { schema: 'W05-continuation-evidence-v1', sealedAt: new Date().toISOString(), recipeCommit: result.recipeCommit, recipeSHA256: result.recipeSHA256, files });
console.log(JSON.stringify({ verdict: 'SCOPED_COMPOSED_11_PLUS_1_EACH', assertions, setup, measured, evidenceSHA256: hashFile(join(own, 'EVIDENCE-MANIFEST.json')), rawFiles: archive.rows.length, stagedEntriesRemoved: workRows.length, originalUnchanged: true, privateUnchanged: true }));
