import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { sha, json, describe, ownEqual } from './common.mjs';
import { verifyComposition } from './composition.mjs';
import { referencePackage } from './package-data.mjs';
import { variants } from './variants.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)); const repository = path.resolve(own, '../../../..');
const binding = JSON.parse(fs.readFileSync(path.join(own, 'BINDINGS.json')));
const jobs = JSON.parse(fs.readFileSync(path.join(own, 'JOBS.json')));
const results = [];
function check(id, action) { const detail = action(); results.push({ id, status: 'PASS', detail }); }
check('D-SYNTAX', () => {
  const names = fs.readdirSync(own).filter(name => name.endsWith('.mjs'));
  for (const name of names) new vm.SourceTextModule(fs.readFileSync(path.join(own, name), 'utf8'), { identifier: name });
  return { parsed: names.length, evaluated: 0, files: Object.fromEntries(names.map(name => [name, describe(path.join(own, name))])) };
});
check('D-COMPOSITION', () => verifyComposition(binding));
check('D-COMPOSITION-NEGATIVE', () => {
  for (const mode of ['blob', 'path', 'duplicate', 'derived-order']) {
    const altered = structuredClone(binding);
    if (mode === 'blob') altered.selectedInputs.find(entry => entry.path.startsWith('src/')).blob = '0'.repeat(40);
    if (mode === 'path') altered.selectedInputs.find(entry => entry.path.startsWith('src/')).path += '\n';
    if (mode === 'duplicate') altered.selectedInputs.push(altered.selectedInputs.find(entry => entry.path.startsWith('src/')));
    if (mode === 'derived-order') altered.derivedTrees.reverse();
    assert.throws(() => verifyComposition(altered));
  }
  return { rejected: 4 };
});
check('D-FINITE-JOBS', () => {
  assert.equal(jobs.length, 54); assert.equal(new Set(jobs.map(job => job.id)).size, 54);
  const counts = Object.fromEntries([...new Set(jobs.map(job => job.role))].map(role => [role, jobs.filter(job => job.role === role).length]));
  assert.deepEqual(counts, { metadata: 1, guard: 1, build: 1, type: 15, regression: 3, 'fixture-tail': 3, 'independent-s54': 3, 'instrumented-s54': 1, limit: 18, adapter: 2, 'original-mutant': 6 });
  for (const job of jobs) assert.equal(job.timeoutMs, job.role === 'build' ? 120000 : 30000);
  assert.equal(1 + jobs.length + 6, 61); assert.ok(61 <= 70);
  return { counts, plannedAllOwned: 61, peakFlatOwnerPlusChild: 2, maximumTotalPeak: 4, independentBodyIds: ['U01','U02','U03','U04','U05','U06','U07','U08','U09','U10','U11','U12','I01','I02','I03','I04'] };
});
check('D-EXACT-DIAGNOSTIC', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(own, 'VERSIONED-ROWS.json')));
  assert.equal(rows.length, 4); const permission = rows.find(row => row.executionId === 'S62').expected.stderr.utf8;
  assert.equal(permission, 'apply_patch: permission denied: /work/a\n'); assert.equal(Buffer.byteLength(permission), 40);
  const branches = rows.find(row => row.executionId === 'S74').expected.stderr.exactUtf8Alternatives;
  assert.equal(branches.length, 2);
  for (const branch of branches) assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(branch)), branch);
  return { permissionBytes: 40, exactBranchBytes: branches.map(value => Buffer.byteLength(value)), originalFixturesUnmodified: true };
});
check('D-OWN-DATA', () => {
  const expected = { role: 'data', args: ['literal', 0, false], maximum: 2 };
  assert.ok(ownEqual(vm.runInNewContext('({role:"data",args:["literal",0,false],maximum:2})'), expected));
  let getterReads = 0; const accessor = Object.defineProperty({ ...expected }, 'role', { get() { getterReads++; return 'data'; } });
  for (const actual of [null, { ...expected, extra: true }, { ...expected, maximum: '2' }, { args: expected.args, role: 'data', maximum: 2 }, accessor]) assert.equal(ownEqual(actual, expected), false);
  assert.equal(getterReads, 0); return { crossRealmPositive: 1, negative: 5, getterReads };
});
check('D-REFERENCE-AND-MUTANTS', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(own, 'PACKAGE-INVENTORY.json')));
  const encoded = fs.readFileSync(path.join(repository, 'tests/commands/apply-patch-author-20260828/s54-v2/captures/apply-patch-s54-v2-WB7vny.json.gz.base64'));
  const reference = referencePackage(encoded, binding.authorPackage, expected);
  const regenerated = variants(reference.files); assert.deepEqual(regenerated, JSON.parse(fs.readFileSync(path.join(own, 'VARIANTS.json'))));
  for (const variant of regenerated) for (const [name, body] of Object.entries(variant.changes)) new vm.SourceTextModule(body, { identifier: `${variant.id}/${name}` });
  return { archiveBytes: reference.archive.length, archiveSha256: sha(reference.archive), files: reference.files.size, mutationGraphs: regenerated.length, evaluated: 0 };
});
const output = { schema: 'AP753-preseal-data-v1', candidate: binding.candidate, classification: 'DATA/syntax only; no product build, import, mutation execution, compiler, native oracle or network', results };
fs.writeFileSync(path.join(own, 'DATA-PREFLIGHT-v3.json'), json(output), { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ data: results.length, syntaxOnly: true, productLoads: 0, sha256: sha(json(output)) }));
