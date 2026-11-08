import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, json } from './artifacts.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), owned = dirname(scope), repository = resolve(owned, '../../..');
const freeze = '8600ca5730a130316b16f13c4cd54689a4b015a9';
const oldSealBytes = execFileSync('/usr/bin/git', ['show', `${freeze}:tests/shell/let-independent-20260828/SEAL.json`], { cwd: repository });
assert.deepEqual(readFileSync(join(owned, 'SEAL.json')), oldSealBytes);
const oldSeal = JSON.parse(oldSealBytes);
for (const [name, digest] of Object.entries(oldSeal)) assert.equal(hash(readFileSync(join(owned, name))), digest, name);
assert.deepEqual(readdirSync(owned).sort(), [...Object.keys(oldSeal), 'SEAL.json', 'execution-prep-v1'].sort(), 'exact original plus this named preparation revision');
const seal = json(join(scope, 'SEAL.json')), actual = {};
for (const name of readdirSync(scope).sort()) {
  const path = join(scope, name), stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink(), name);
  if (name !== 'SEAL.json') actual[name] = hash(readFileSync(path));
}
assert.deepEqual(actual, seal);
const synthetic = readFileSync(join(scope, 'synthetic-worker.mjs'), 'utf8');
const procedures = [...synthetic.matchAll(/async (S\d\d)\(\)/gu)].map(match => match[1]);
assert.deepEqual(procedures, json(join(owned, 'synthetic.json')).map(row => row.id));
assert.equal(procedures.length, 26); assert.equal(json(join(owned, 'cases.json')).length, 58);
const protocol = json(join(scope, 'SELFTEST-v4.json'));
assert.equal(protocol.actualReceiptChildren, 10); assert.equal(protocol.comparatorControls.length, 6); assert.equal(protocol.admissionRefusal.code, 78);
assert.equal(protocol.productExecutions, 0); assert.equal(protocol.builds, 0); assert.equal(protocol.nativeReruns, 0);
for (const [name, digest] of Object.entries(protocol.files)) assert.equal(hash(readFileSync(join(scope, name))), digest, name);
for (const row of protocol.records) assert.equal(row.run.groupAbsent, true);
for (const mode of ['late-exit', 'late-throw']) {
  const row = protocol.records.find(entry => entry.mode === mode); assert.equal(row.result.passed, 1); assert.equal(row.result.accepted, false);
}
const admission = json(join(scope, 'ADMISSION-SELFTEST-v5.json'));
assert.equal(admission.completed, true); assert.equal(admission.runs.length, 8); assert.equal(admission.scratchRemoved, true); assert.equal(admission.inputHashesUnchanged, true);
for (const [name, digest] of Object.entries(admission.files)) assert.equal(hash(readFileSync(join(scope, name))), digest, name);
for (const row of admission.runs) {
  assert.equal(row.checked, true); assert.equal(row.run.groupAbsent, true); assert.equal(row.run.failure, null);
  assert.equal(row.run.code, row.mode === 'positive' ? 0 : 1);
  assert.equal(row.manifest.nodeSha256, admission.node.sha256);
}
for (const name of ['ADMISSION-SELFTEST.json', 'ADMISSION-SELFTEST-v2.json', 'ADMISSION-SELFTEST-v3.json']) assert.ok(json(join(scope, name)).failure);
const tools = json(join(scope, 'TOOLS.json'));
assert.equal(hash(readFileSync(tools.node.path)), tools.node.sha256); assert.equal(hash(readFileSync(tools.patch.path)), tools.patch.sha256);
for (const tree of tools.trees) assert.deepEqual(inventory(tree.path), tree.files, tree.name);
assert.equal(tools.node.sha256, protocol.node.sha256); assert.equal(tools.node.sha256, admission.node.sha256);
process.stdout.write(JSON.stringify({ verdict: 'executable preparation sealed; no product acceptance', unchangedFreeze: freeze, literalRows: 58, syntheticExecutors: 26, latestActualHarnessChildren: 19, classifierModels: 6, earlierFailuresPreserved: true, productExecutions: 0, candidateBuilds: 0, nativeReruns: 0 }) + '\n');
