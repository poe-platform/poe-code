import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { census, digest, verifyTree, tarInventory } from './boundary-app.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), work = path.join(here, 'public-v2-app-5xarxw');
const typeBytes = fs.readFileSync(path.join(work, 'TYPE-RESULT.json')), phaseBytes = fs.readFileSync(path.join(work, 'RUNTIME-PHASE1-RESULT.json'));
assert.equal(digest(typeBytes), '046e4346bb6da263d99d34557d13f39845b4a1df61ff91890ac497d451f3e3e5');
assert.equal(digest(phaseBytes), '178e1e91eea739f1435aa40340db59e69bfe62aa8e34121a31d970bbed1134f8');
const types = JSON.parse(typeBytes), phase = JSON.parse(phaseBytes);
assert.equal(types.accepted, true); assert.equal(types.types.length, 10); assert.ok(types.types.every(row => row.accepted));
assert.equal(phase.unsafeStop, true); assert.equal(phase.runs.length, 1); assert.equal(phase.guards.length, 6); assert.ok(phase.guards.every(row => row.accepted));
const run = phase.runs[0]; assert.equal(run.outer.code, 78); assert.equal(run.capture.run.code, 13);
assert.equal(run.capture.verdict.observations.length, 27); assert.deepEqual(run.capture.verdict.failed, ['S06']); assert.equal(run.capture.integrityError, null);
assert.ok(run.capture.run.stderr.includes('Detected unsettled top-level await'));
const children = [...types.types.map(row => row.run), run.outer, run.capture.run];
for (const child of children) assert.ok(child.closeObserved && child.groupAbsent && !child.signal && !child.fault && !child.spawnError);
const manifestBytes = fs.readFileSync(path.join(work, 'RUNTIME-MANIFEST.json')); assert.equal(digest(manifestBytes), phase.manifestSha256);
const manifest = JSON.parse(manifestBytes);
for (const tree of manifest.trees) verifyTree(tree);
const typeBinding = JSON.parse(fs.readFileSync(types.bindingPath));
for (const tree of typeBinding.trees) {
  if (tree.root !== types.app) verifyTree(tree);
  else {
    const now = census(types.app);
    for (const [filename, entry] of Object.entries(tree.entries)) assert.deepEqual(now[filename], entry, 'type-admitted member unchanged while adding sealed runtime harness');
  }
}
const packageBytes = fs.readFileSync(manifest.packageTar); assert.equal(digest(packageBytes), '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
const inventory = tarInventory(packageBytes); assert.equal(Object.keys(inventory).length, 862);
assert.deepEqual(Object.fromEntries(Object.entries(census(types.packageRoot)).filter(([, entry]) => !entry.directory)), inventory);
assert.equal(digest(fs.readFileSync(types.node.path)), types.node.sha256);
const npm = verifyTool(JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'), 'utf8').trim(), 'base64'))));
const recordNames = ['TYPE-BINDING.json', 'TYPE-PRELAUNCH.json', 'TYPE-RESULT.json', 'RUNTIME-MANIFEST.json', 'RUNTIME-GO.json', 'RUNTIME-GUARDS.json', 'BAD-MANIFEST.json', 'BAD-GO.json', 'RUNTIME-semantic.json', 'RUNTIME-PHASE1-RESULT.json'];
const records = Object.fromEntries(recordNames.map(name => { const bytes = fs.readFileSync(path.join(work, name)); return [name, { sha256: digest(bytes), bytes: bytes.length, base64: bytes.toString('base64') }]; }));
const stage = { root: work, entries: census(work) };
const encodedInput = Buffer.from(JSON.stringify({ kind: 'array-first-runtime-and-versioned-types-preserved-v1', presealTypes: '0f76165f', presealRuntime: 'f8f740f4', records, stage, exactPackageReference: { path: 'ADMISSION-02.json.gz.base64', encodedSha256: '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a', sha256: digest(packageBytes), members: 862 }, qualification: '27 completed semantic observations, not whole-cohort acceptance; O11 observer unsafe exit stopped all dependents.' }));
const encoded = gzipSync(encodedInput, { level: 9 }).toString('base64') + '\n';
function put(name, text) {
  const filename = path.join(here, name); assert.ok(!fs.existsSync(filename));
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${filename}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
}
put('FIRST-RUNTIME-01.json.gz.base64', encoded);
assert.equal(digest(gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'FIRST-RUNTIME-01.json.gz.base64'), 'utf8').trim(), 'base64'))), digest(encodedInput));
verifyTree(stage); verifyTool(npm); assert.equal(fs.realpathSync(work), work);
fs.rmSync(work, { recursive: true }); assert.ok(!fs.existsSync(work));
const summary = { kind: 'array-first-runtime-bounded-hold', types: { versionedAdmissionPassed: 9, versionedAdmissionTotal: 9, originalFixtureExactNegativeControlPassed: 1, originalFixtureCode: 2, originalFailureRescored: false }, runtime: { requested: 33, completedObservations: 27, passedObservations: 26, failedObservations: ['S06'], incompleteObservation: 'O11', notStarted: ['O12', 'O13', 'O14', 'O15', 'O16'], childCode: 13, runnerCode: 78, unsafeStop: true, actualLoadedFiles: run.capture.verdict.loads.length, holdoutsExecuted: 0, operationsExecuted: 0, mechanicalExecuted: 0, mutantsExecuted: 0, installedExecuted: 0, movedExecuted: 0 }, guardControlsPassed: 6, guardControlsTotal: 6, candidate: types.candidate, product: types.product, selectedTree: types.selectedTree, packageSha256: types.packageSha256, packageMembers: 862, encodedSha256: digest(encoded), decodedSha256: digest(encodedInput), encodedBytes: encoded.length, decodedBytes: encodedInput.length, records: Object.fromEntries(Object.entries(records).map(([name, record]) => [name, { sha256: record.sha256, bytes: record.bytes }])), children: { typeChildren: 10, runtimeRunner: 1, runtimeWorker: 1, total: 12, closeObserved: 12, groupsAbsent: 12, active: 0 }, cleanup: { root: work, removedAfterCaptureAndIntegrity: true }, nativeCalls: 0, privateEngineCalls: 0, buildRetries: 0, accepted: false };
put('FIRST-RUNTIME-01-SUMMARY.json', JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary, null, 2));
