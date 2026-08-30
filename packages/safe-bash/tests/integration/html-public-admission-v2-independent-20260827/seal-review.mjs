import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function digest(filename) {
  const buffer = Buffer.alloc(65536), hash = createHash('sha256'), descriptor = openSync(filename, 'r');
  try { let count; while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(descriptor); }
  return hash.digest('hex');
}
function read(name) { return JSON.parse(readFileSync(join(own, name))); }
function inventory(prefix = '') {
  const result = {};
  for (const name of readdirSync(join(own, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (path === 'MANIFEST.json') continue;
    const filename = join(own, path), stat = lstatSync(filename);
    assert.ok(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) Object.assign(result, inventory(path));
    else {
      assert.ok(stat.isFile(), path);
      assert.ok(!/\.(?:ts|mts|cts)$/u.test(path), path);
      assert.notEqual(name, 'AGENTS.md');
      result[path] = { sha256: digest(filename), bytes: stat.size, mode: stat.mode & 0o777 };
    }
  }
  return result;
}
const operation = process.argv[2];
assert.ok(['write', 'check'].includes(operation));
assert.equal(digest(fileURLToPath(import.meta.url)), read('SEAL-TOOL-PRE.json').sha256);
const controls = read('execution/controls/SUMMARY.json');
assert.equal(controls.controls, 35); assert.equal(controls.passed, 34); assert.equal(controls.failed, 1);
assert.equal(controls.candidateRuntimeCasesExecuted, 0); assert.equal(controls.compilerOrNpmExecuted, false);
for (const [path, expected] of Object.entries(controls.raw)) assert.equal(digest(join(own, 'execution/controls', path)), expected);
const failed = read('execution/controls/031-over1GiB-positive-backpressure.json');
assert.equal(failed.status, 'fail'); assert.equal(failed.error.code, 'ERR_ASSERTION'); assert.match(failed.error.message, /maxRssBytes < 256/u);
const supervisor = read('execution/SUPERVISOR.json');
assert.equal(supervisor.allPassed, false); assert.equal(supervisor.results.length, 1);
assert.deepEqual(supervisor.unexecutedPhases, ['extra-controls', 'admission', 'reconstruction']);
assert.equal(supervisor.results[0].code, 1); assert.equal(supervisor.results[0].signal, null);
assert.equal(supervisor.results[0].closeObserved, true); assert.deepEqual(supervisor.results[0].remainingGroupMembers, []); assert.deepEqual(supervisor.results[0].signalsSent, []);
const settlement = read('SETTLEMENT.json');
assert.equal(settlement.removed, true); assert.deepEqual(settlement.remainingGroups, []); assert.equal(existsSync(join(own, 'scratch')), false);
assert.equal(existsSync(join(own, 'execution/admission')), false);
const scratch = read('SCRATCH-RECEIPT.json'), compressed = readFileSync(join(own, 'SCRATCH-INVENTORY.json.gz.data'));
assert.equal(hash(compressed), scratch.sha256); assert.equal(hash(gunzipSync(compressed)), scratch.payloadSha256);
const before = read('PRE.json'), after = read('POST-COMPLETE.json');
assert.equal(before.archive.sha256, after.archive.sha256); assert.equal(after.archive.bytes, 2340945920); assert.equal(after.archive.code, 0); assert.equal(after.archive.closeObserved, true);
assert.equal(after.immutableFiles, 108); assert.equal(after.originalFixtures, 18); assert.equal(after.du75FrozenFiles, 15);
assert.equal(after.helperAndToolsUnchanged, true); assert.equal(after.concurrentIndexChangesReconciled, true);
for (const [name, expected] of Object.entries(read('EXECUTION-FREEZE.json').helpers)) assert.equal(digest(join(own, name)), expected);
assert.equal(digest(join(own, 'authenticate-initial.mjs.data')), read('BOOTSTRAP.json').sha256);
assert.equal(digest(join(own, 'authenticate-initial.mjs.data')), read('BOOTSTRAP-CORRECTED.json').sha256);
assert.equal(digest(join(own, 'authenticate.mjs')), read('BOOTSTRAP-READY.json').sha256);
assert.equal(digest(join(own, 'post-reconcile.mjs')), read('POST-RECONCILE-INVOCATION.json').sha256);
const files = inventory();
const filename = join(own, 'MANIFEST.json');
if (operation === 'write') {
  writeFileSync(filename, `${JSON.stringify({ schema: 'html74-independent-admission-v2-review/1', at: new Date().toISOString(), disposition: 'BLOCKED: one independent RSS control failure; not admission acceptance', candidate: before.candidate, authorSealedCommit: before.sealedCommit, controls: { executed: 35, passed: 34, failed: 1 }, additionalControlsExecuted: 0, positiveMaterializationsExecuted: 0, compilerBuildsExecuted: 0, fullPackReproductionsExecuted: 0, reconstructionsExecuted: 0, actual34: 0, publicAcceptance: false, wholeGate: false, coveredFiles: Object.keys(files).length, fileCountIncludingManifest: Object.keys(files).length + 1, files }, null, 2)}\n`, { flag: 'wx' });
} else assert.deepEqual(files, read('MANIFEST.json').files);
console.log(JSON.stringify({ operation, disposition: 'BLOCKED', coveredFiles: Object.keys(files).length, fileCountIncludingManifest: Object.keys(files).length + 1, manifestSha256: digest(filename), actual34: 0, integrityOnly: true }));
