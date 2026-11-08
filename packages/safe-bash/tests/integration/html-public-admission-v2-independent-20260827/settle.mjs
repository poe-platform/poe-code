import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const base = join(repository, 'tests/integration/html-public-independent-20260827/admission-v2');
const scratch = join(own, 'scratch');
const execution = join(own, 'execution');
const binding = JSON.parse(readFileSync(join(base, 'binding-04/BINDINGS.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function digest(filename) {
  const buffer = Buffer.alloc(65536), hash = createHash('sha256'), descriptor = openSync(filename, 'r');
  try { let count; while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(descriptor); }
  return hash.digest('hex');
}
function json(filename, value) { writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function read(name) { return JSON.parse(readFileSync(join(execution, name))); }
function inventory(directory, prefix = '') {
  const result = {};
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const filename = join(directory, path), stat = lstatSync(filename);
    if (stat.isSymbolicLink()) result[path] = { kind: 'symlink', target: readlinkSync(filename), followed: false };
    else if (stat.isDirectory()) { result[path] = { kind: 'directory', mode: stat.mode & 0o777 }; Object.assign(result, inventory(directory, path)); }
    else { assert.ok(stat.isFile(), filename); result[path] = { kind: 'file', bytes: stat.size, mode: stat.mode & 0o777, sha256: digest(filename) }; }
  }
  return result;
}
function contained(path) { assert.ok(path.startsWith(`${scratch}/`), path); assert.ok(!relative(scratch, path).split('/').includes('..')); }
function selected(view) {
  contained(view);
  return binding.inputs.map(entry => {
    const filename = join(view, entry.path), stat = lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
    assert.equal(stat.mode & 0o777, Number.parseInt(entry.mode.slice(3), 8), entry.path);
    assert.equal(digest(filename), entry.sha256, entry.path);
    return { path: entry.path, mode: stat.mode & 0o777, sha256: entry.sha256, bytes: stat.size };
  });
}
const frozen = JSON.parse(readFileSync(join(own, 'EXECUTION-FREEZE.json')));
for (const [name, expected] of Object.entries(frozen.helpers)) assert.equal(digest(join(own, name)), expected, name);
const supervisor = read('SUPERVISOR.json');
assert.ok(supervisor.results.every(result => result.closeObserved && result.remainingGroupMembers.length === 0));
const ps = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, timeout: 10000 });
assert.ifError(ps.error);
assert.equal(ps.status, 0);
const groups = supervisor.results.map(result => result.pgid);
const remaining = ps.stdout.split('\n').filter(line => groups.includes(Number(line.trim().split(/\s+/u)[2])));
assert.deepEqual(remaining, []);
json(join(own, 'SETTLEMENT-PRE.json'), { at: new Date().toISOString(), helperSha256: digest(fileURLToPath(import.meta.url)), groups, remaining, cleanupRoot: scratch, cleanupPolicy: 'Only owned scratch after group closure, authenticated source/pack/mode verification and compressed recursive receipt roundtrip; no external/author scratch removal', actual34: 0 });
const evidence = { actual34: 0, allPassed: supervisor.allPassed, independentlyExecuted: supervisor.results.map(result => result.name), unexecuted: supervisor.unexecutedPhases };
if (supervisor.allPassed) {
  const controls = read('controls/SUMMARY.json'), extra = read('extra-controls/SUMMARY.json');
  assert.equal(controls.controls, 35); assert.equal(controls.passed, 35); assert.equal(controls.failed, 0);
  assert.equal(extra.controls, 4); assert.equal(extra.passed, 4); assert.equal(extra.failed, 0);
  const admission = read('admission/REPORT.json'), pack = read('admission/PACK.json');
  assert.equal(admission.status, 'admission-proof-complete-review-pending');
  assert.equal(admission.candidateRuntimeCasesExecuted, 0);
  assert.equal(admission.materialized.files, 410);
  assert.equal(admission.materialized.bytes, 65377928);
  assert.equal(admission.materialized.symlinks, 0);
  assert.equal(pack.count, 830); assert.equal(pack.emittedCount, 828);
  assert.equal(pack.sha256, binding.pack.sha256);
  assert.deepEqual(pack.files, binding.pack.files);
  assert.equal(hash(Buffer.from(readFileSync(join(execution, 'admission/package.tgz.base64'), 'utf8'), 'base64')), binding.pack.sha256);
  for (const archive of [admission.archiveBefore, admission.archiveAfter]) {
    assert.equal(archive.bytes, 2340945920); assert.equal(archive.sha256, binding.archive.sha256);
    assert.equal(archive.process.status, 0); assert.equal(archive.process.signal, null);
  }
  const rebuilt = read('reconstruction/RESULT.json'), reconstructionPre = read('reconstruction/PRE.json');
  assert.equal(rebuilt.candidate, binding.candidate); assert.equal(rebuilt.tree, binding.tree);
  assert.equal(rebuilt.scopedInputs, 410); assert.equal(rebuilt.parentDeltaPaths, 2);
  assert.equal(rebuilt.fullClone, false); assert.equal(rebuilt.candidateSourceCommitRead, false);
  const materialized = { admission: selected(join(admission.scratch, 'build')), reconstruction: selected(join(reconstructionPre.scratch, 'inputs')) };
  json(join(own, 'MATERIALIZED-MODES-AND-HASHES.json'), materialized);
  evidence.controls = { executed: 39, passed: 39, failed: 0, streamPathLinkHash: 35, actualMaterializeReconstruct: 4 };
  evidence.materialization = { eachInputs: 410, eachBytes: 65377928, independentlyModeAndHashCheckedViews: 2, historicalLinks: 12, materializedHistoricalLinks: 0 };
  evidence.pack = { sha256: pack.sha256, files: pack.count, emitted: pack.emittedCount };
  evidence.reconstruction = rebuilt;
  evidence.archives = { before: admission.archiveBefore, after: admission.archiveAfter };
  evidence.compilerInputs = read('admission/COMPILER-INPUTS.json');
}
const scratchInventory = inventory(scratch);
const raw = Buffer.from(`${JSON.stringify({ at: new Date().toISOString(), root: scratch, entries: scratchInventory, scope: 'Exact scratch file byte digests, modes, directories and literal symlink targets; content is not embedded. Immutable selected inputs remain in Git; reproduced pack is retained separately.' })}\n`);
const compressed = gzipSync(raw);
const receipt = join(own, 'SCRATCH-INVENTORY.json.gz.data');
writeFileSync(receipt, compressed, { flag: 'wx' });
assert.deepEqual(gunzipSync(readFileSync(receipt)), raw);
json(join(own, 'SCRATCH-RECEIPT.json'), { sha256: hash(compressed), payloadSha256: hash(raw), compressedBytes: compressed.length, payloadBytes: raw.length, entries: Object.keys(scratchInventory).length, files: Object.values(scratchInventory).filter(entry => entry.kind === 'file').length, symlinks: Object.entries(scratchInventory).filter(([, entry]) => entry.kind === 'symlink'), regularBytes: Object.values(scratchInventory).reduce((total, entry) => total + (entry.bytes ?? 0), 0), rawSourceRetained: false, contentDisposition: 'Authenticated immutable Git inputs and tool receipts retained; not a full scratch-content archive. Reproduced full package base64 retained in execution/admission.' });
rmSync(scratch, { recursive: true });
assert.equal(existsSync(scratch), false);
json(join(own, 'SETTLEMENT.json'), { at: new Date().toISOString(), cleanupRoot: scratch, removed: true, remainingGroups: remaining, childGroups: groups, signalsSent: supervisor.results.flatMap(result => result.signalsSent), evidence });
console.log(JSON.stringify({ allPassed: evidence.allPassed, controls: evidence.controls, materialization: evidence.materialization, pack: evidence.pack, scratchRemoved: true, childGroupsRemaining: remaining.length, actual34: 0 }));
