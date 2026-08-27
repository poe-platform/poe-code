import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Meter } from './inherited-model.mjs';
import { authenticateInputs, hash, inventory, load } from './integrity.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(process.argv[2] ?? process.cwd());
const meter = new Meter({ work: 50000000, allocation: 50000000 });
const manifestBytes = load(directory, 'ARTIFACT-MANIFEST.data', meter, false);
meter.charge(manifestBytes.length * 32, manifestBytes.length * 32);
const manifest = JSON.parse(manifestBytes);
const auth = load(directory, 'AUTHENTICATION.data', meter);
const binding = load(directory, 'frozen/BINDINGS.json', meter);
const before = inventory(directory, meter);
assert.deepEqual(before.filter(entry => entry.path !== 'ARTIFACT-MANIFEST.data'), manifest.entries);

function committed(entry) {
  meter.charge(128 + entry.bytes * 8, 128 + entry.bytes * 4);
  const bytes = execFileSync('git', ['show', `${entry.commit}:${entry.path}`], { cwd: repository, maxBuffer: 4194304, timeout: 10000 });
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
function historical(value) {
  meter.charge(128, 16);
  if (!value || typeof value !== 'object') return;
  if (value.commit && value.path && value.sha256) committed(value);
  for (const child of Object.values(value)) historical(child);
}
function guards() {
  for (const entry of auth.sourceGuards) {
    meter.charge(entry.bytes * 32, entry.bytes * 32);
    assert.equal(hash(readFileSync(path.join(repository, entry.path))), entry.sha256, entry.path);
  }
  for (const entry of auth.freezeFiles) committed({ ...entry, commit: auth.freezeCommit, path: `tests/commands/expr-stress/nullable-hierarchy-v5-20260827/freeze/${entry.path}` });
  committed({ commit: '938fdbc6f128c5ba124d13879c3354a9ee46fc95', path: 'tests/commands/expr-stress/nullable-history-order-v4-20260827/design/model.mjs', sha256: auth.inheritedModelSha256, bytes: 12331 });
}
historical(binding);
guards();
authenticateInputs(directory, meter);
const capture = load(directory, 'run-01.data', meter);
meter.charge(1048576, 1048576);
const replay = spawnSync(process.execPath, [path.join(directory, 'run-prototype.mjs')], { cwd: directory, timeout: 30000, maxBuffer: 1048576 });
assert.equal(replay.error, undefined);
assert.equal(replay.signal, null);
assert.equal(replay.status, 1, 'Expected policy HOLD, not accepted comparator');
assert.equal(replay.stderr.length, 0, replay.stderr.toString());
assert.deepEqual(JSON.parse(replay.stdout.toString()), capture);
assert.equal(capture.counts.failedChecks, 0);
assert.equal(capture.counts.preservedTargetFailures, 6);
authenticateInputs(directory, meter);
guards();
assert.deepEqual(inventory(directory, meter), before);
assert.deepEqual(load(directory, 'ARTIFACT-MANIFEST.data', meter, false), manifestBytes);
console.log(JSON.stringify({ integrityReplay: true, policyAcceptance: false, manifestSha256: hash(manifestBytes), childExitCode: replay.status, counts: capture.counts, sourceGuardPaths: auth.sourceGuards.length, completeArchiveEntryInventoryBeforeAfter: true, detectsNewFilesDirectoriesSymlinks: true, liveGuardIsNotAppendProofSourceAudit: true, childrenSettled: true, meter: { work: meter.work, allocation: meter.allocation } }, null, 2));
