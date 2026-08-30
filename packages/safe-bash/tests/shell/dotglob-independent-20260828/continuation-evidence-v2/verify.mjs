import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash, packInventory, git } from '../execution-prep-v1/artifacts.mjs';
import { digestFile } from '../execution-prep-v1/admission.mjs';
import { verifyInputs } from '../execution-prep-v1/verify-inputs.mjs';
import { history, carried, correctedRow, bindLoads, matrix, checkMutant, packSha256 } from '../continuation-v2/proof.mjs';
import { checkGuard } from '../continuation-v2/guards.mjs';
import { packageDelta } from '../execution-v2/guards.mjs';
const ownRoot = fileURLToPath(new URL('../', import.meta.url)), repository = resolve(ownRoot, '../../..');
const prefix = 'tests/shell/dotglob-independent-20260828/';
const root = new URL('./continuation-01/', import.meta.url);
const seal = JSON.parse(readFileSync(new URL('RESULT-SEAL.json', root)));
const encoded = readFileSync(new URL('RESULT.json.gz.base64', root)); assert.equal(hash(encoded), seal.encodedSha256);
const raw = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 });
assert.equal(hash(raw), seal.sha256); assert.equal(raw.length, seal.bytes);
const report = JSON.parse(raw), binding = JSON.parse(readFileSync(join(ownRoot, 'stack-binding-v1/BINDING.json')));
const preseal = JSON.parse(readFileSync(join(ownRoot, 'continuation-v2/SEAL.json')));
assert.deepEqual(readFileSync(join(ownRoot, 'continuation-v2/SEAL.json')), git(repository, ['show', `${report.revision}:${prefix}continuation-v2/SEAL.json`]));
for (const [name, expected] of Object.entries(preseal.files)) {
  digestFile(join(ownRoot, name), expected);
  assert.equal(hash(git(repository, ['show', `${report.revision}:${prefix}${name}`])), expected);
}
const frozen = verifyInputs(repository); correctedRow();
const oldEncoded = join(ownRoot, 'candidate-evidence-v1/review-01/RESULT.json.gz.base64');
assert.deepEqual(readFileSync(oldEncoded), git(repository, ['show', `2e2bfa68:${prefix}candidate-evidence-v1/review-01/RESULT.json.gz.base64`]));
const old = history(oldEncoded); assert.deepEqual(carried(old, binding), report.carried);
const archive = Buffer.from(readFileSync(new URL('PACKAGE.tgz.base64', root), 'utf8').trim(), 'base64');
assert.equal(hash(archive), packSha256); assert.deepEqual(packInventory(archive), old.pack.members);
assert.deepEqual(packageDelta(binding, archive).members, report.pack.members);
assert.equal(report.accepted, true); assert.equal(seal.accepted, true); assert.equal(report.error, undefined); assert.equal(report.unsafeStop, false);
assert.deepEqual(report.binding.candidateInputs, old.binding.candidateInputs);
assert.deepEqual(report.binding.sourceBefore, report.sourceAfter); assert.deepEqual(report.sourceAfter, report.finalSourceCensus);
assert.equal(report.finalNodeSha256, binding.node.sha256);
function resolution(record) {
  const rows = record.run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const resolutions = rows.filter(row => row.diagnostic?.role === 'public-resolution-before-import');
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].diagnostic.rootURL, pathToFileURL(record.rootModule).href);
  assert.equal(resolutions[0].diagnostic.contractsURL, pathToFileURL(record.contractsModule).href);
  assert.deepEqual(resolutions[0].diagnostic.boundary, record.boundary);
  assert.equal(resolutions[0].diagnostic.node, binding.node.path); assert.equal(resolutions[0].diagnostic.version, binding.node.version);
  assert.equal(record.run.executable, binding.node.path); assert.ok(record.run.args.includes('--permission'));
  for (const arg of record.run.args.filter(arg => arg.startsWith('--allow-fs-read='))) {
    const target = arg.slice('--allow-fs-read='.length); assert.ok(target.startsWith(report.work + '/') || target === binding.node.path, 'no ambient read grant');
  }
  for (const arg of record.run.args.filter(arg => arg.startsWith('--allow-fs-write='))) assert.ok(arg.slice('--allow-fs-write='.length).startsWith(report.work + '/scratch-'), 'only owned VFS scratch writes');
  assert.deepEqual(record.appBefore, record.appAfter);
}
assert.deepEqual(report.layouts.map(row => row.layout), ['source', 'installed', 'moved']);
for (const layout of report.layouts) {
  for (const [key, id] of [['glob', 'G039-v2'], ['r24', 'R24-v2']]) {
    const record = layout[key]; resolution(record);
    assert.equal(bindLoads(record, [id]).accepted, true);
    assert.equal(record.runtimeSha256, report.pack.members['dist/shell/runtime.js'].sha256);
  }
  const details = layout.r24.classification.observations[0].details;
  assert.equal(details.version, 'R24-v2'); assert.equal(details.layout, layout.layout);
  assert.equal(details.originalR24, 'failed and preserved'); assert.deepEqual(details.inherited, report.carried);
}
assert.deepEqual(report.mutants.map(row => row.id), matrix.map(([id]) => id));
for (const record of report.mutants) {
  checkMutant(record, report.pack.members); resolution(record.mutant); resolution(record.restored);
  assert.equal(record.mutantInventory['dist/shell/runtime.js'].sha256, record.mutant.runtimeSha256);
  assert.deepEqual(Object.keys(record.mutantInventory).sort(), Object.keys(report.pack.members).sort());
  for (const [name, entry] of Object.entries(record.mutantInventory)) {
    assert.equal(entry.mode, report.pack.members[name].mode);
    if (!/^dist\/shell\/(?:runtime|shell)\./u.test(name)) assert.deepEqual(entry, report.pack.members[name]);
  }
  if (record.id === 'accepted-stack-reversion') assert.equal(record.mutant.runtimeSha256, binding.package.members['dist/shell/runtime.js'].sha256);
}
assert.equal(report.guards.length, 9); for (const guard of report.guards) checkGuard(guard);
assert.deepEqual(report.counts, { product: 28, guard: 9, tool: 3 }); assert.equal(report.children.length, 40);
for (const child of report.children) { assert.equal(child.closeObserved, true); assert.equal(child.groupAbsent, true); assert.equal(child.failure, null); assert.equal(child.spawnError, null); assert.equal(child.signal, null); }
assert.equal(report.move.fromAbsent, true); assert.notEqual(report.move.from, report.move.to); assert.deepEqual(report.move.before, report.move.after);
assert.equal(report.cleanup.absent, true); assert.equal(existsSync(report.cleanup.exactOwnedRootRemoved), false);
console.log(JSON.stringify({ role: 'offline immutable-capture verification; no product replay', originalFiles: frozen.checked.length, new: { G039v2: 3, R24v2: 3, actualMutantKills: 11, restoredPositives: 11, guards: 9, reapedChildren: 40 }, carried: report.carried, wholePack: 846, defaultCount: 77, accepted: true }));
