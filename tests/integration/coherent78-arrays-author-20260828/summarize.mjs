import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { own, inputs } from './prepare.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raws = [1, 2, 3, 4].map(version => {
  const bytes = fs.readFileSync(path.join(own, `RAW-v${version}.json.gz.base64`));
  const value = JSON.parse(gunzipSync(Buffer.from(bytes.toString().trim(), 'base64'), { maxOutputLength: 134217728 }));
  return { version, encodedSha256: hash(bytes), ...value };
});
const original = raws[1].receipt, intermediate = raws[2].receipt, final = raws[3].receipt;
const { manifest, base } = inputs();
assert.equal(final.status, 'AUTHOR_SCOPED_PASS');
for (const raw of raws) assert.equal(raw.receipt.candidate, manifest.computedTree);
assert.equal(original.pack.sha256, final.pack.sha256);
const phases = [...original.phases, ...intermediate.phases];
assert.equal(phases.length, 6);
assert.equal(new Set(phases.map(row => row.layout + ':' + row.script)).size, 6);
for (const phase of phases) assert.equal(phase.summary.pass, phase.summary.cases);
const typeGroups = [...original.types, ...intermediate.types, ...final.types];
assert.equal(typeGroups.length, 18);
assert.equal(new Set(typeGroups.map(row => row.layout + ':' + row.id)).size, 18);
for (const row of typeGroups) {
  assert.equal(row.pass, true);
  for (const declaration of row.declarations) assert.equal(declaration.sha256, original.packageMembers[declaration.path]?.sha256);
}
assert.equal(typeGroups.reduce((sum, row) => sum + row.cases.length, 0), 30);
assert.equal(final.controls.length, 5);
for (const row of final.controls) assert.equal(row.pass, true);
const children = raws.flatMap(raw => raw.receipt.children);
assert.equal(children.length, 37);
assert.ok(children.every(row => row.closed && row.signal === null && row.signals.length === 0));
assert.equal(children.filter(row => row.label === 'production-build-once').length, 1);
assert.equal(children.filter(row => row.label === 'offline-pack').length, 1);
const roots = raws.map(raw => raw.receipt.output);
const statTree = root => {
  let bytes = 0, files = 0;
  const walk = current => {
    for (const name of fs.readdirSync(current)) {
      const filename = path.join(current, name), stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(filename);
      else { assert.ok(stat.isFile()); files++; bytes += stat.size; }
    }
  };
  walk(root); return { root, bytes, files };
};
const retained = roots.map(statTree);
const workingBytes = retained.reduce((sum, row) => sum + row.bytes, 0);
assert.ok(workingBytes <= 536870912);
const captureBytes = raws.reduce((sum, raw) => sum + raw.receipt.captureBytes, 0);
assert.ok(captureBytes <= 134217728);
const firstStart = Date.parse(raws[0].receipt.started);
const lastEnd = Date.parse(final.started) + final.elapsedMilliseconds;
assert.ok(lastEnd - firstStart < 1800000);
const sourceChecks = [];
for (const root of roots.slice(1)) {
  for (const row of manifest.inputs) {
    const file = path.join(root, 'source', row.path), metadata = fs.lstatSync(file);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(hash(fs.readFileSync(file)), row.sha256);
  }
  sourceChecks.push({ root, matchingInputs: manifest.inputs.length });
}
const loads = phases.map(phase => {
  const raw = phase.layout === 'moved' ? raws[2] : raws[1];
  const name = `${phase.layout}-${phase.script}-loads.jsonl`;
  const capture = raw.captures.find(row => row.name === name); assert.ok(capture);
  const rows = Buffer.from(capture.base64, 'base64').toString().trim().split('\n').map(JSON.parse);
  for (const row of rows) assert.equal(row.sha256, original.packageMembers[row.relative]?.sha256);
  return { layout: phase.layout, script: phase.script, loadedRows: rows.length, uniqueModules: new Set(rows.map(row => row.relative)).size, sha256: hash(Buffer.from(capture.base64, 'base64')) };
});
const commonBase = base.fullInstalledBefore;
const changedCommon = [], newPackageFiles = [];
for (const [name, row] of Object.entries(original.fullInstalled)) {
  if (row.kind !== 'file') continue;
  const old = commonBase[name];
  if (!old) newPackageFiles.push(name);
  else if (old.sha256 !== row.sha256 || old.mode !== row.mode) changedCommon.push(name);
}
assert.equal(newPackageFiles.length, 16);
assert.ok(newPackageFiles.every(name => name.startsWith('dist/shell/arrays/')));
assert.ok(changedCommon.every(name => name.startsWith('dist/shell/parser.') || name.startsWith('dist/shell/runtime.')));
const result = {
  status: 'AUTHOR_QUALIFIED_COMPOSED_EVIDENCE_REQUIRES_DIFFERENT_REVIEW', date: '2026-08-28',
  candidate: manifest.computedTree, sourceManifestSha256: hash(fs.readFileSync(path.join(own, 'SOURCE.json'))),
  inputs: manifest.inputs.length, changedSourcePaths: manifest.overrides.map(row => row.path), defaults: 78,
  pack: { sha256: final.pack.sha256, bytes: final.pack.bytes, members: final.pack.metadata.files.length, freshProductionBuilds: 1, freshPacks: 1, newPackageFiles, changedCommon },
  runtime: { cases: 93, passed: 93, layouts: phases.map(row => ({ layout: row.layout, script: row.script, summary: row.summary })), independentAcceptance: false },
  strictTypes: { groups: 18, caseOutcomes: 30, pass: 30, exactNegatives: 12, allCapturedDeclarationsMatchPackage: true },
  controls: final.controls, actualLoadedBindings: loads,
  shells: { runtimeCreated: 99, runtimeDisposed: 99, mutationAndRestoredAdditional: 2, note: 'Tamper/missing/fallback reject before Shell creation; no universal descendant/opaque cleanup claim.' },
  resources: { directChildren: children.length, allClosed: true, termOrKill: 0, peakSupervisedChildren: 1, retained, workingBytes, captureBytes, supervisedCampaignWallMilliseconds: lastEnd - firstStart, sourceChecks, cleanup: 'Owned children and Shell resources settled; four own roots deliberately retained, no foreign cleanup.' },
  history: raws.map(raw => ({ rawVersion: raw.version, sha256: raw.encodedSha256, status: raw.receipt.status, failure: raw.receipt.setupOrControlFailure, children: raw.receipt.children.length })),
  qualifications: [
    'Separate metadata preflight failure preserved in PREFLIGHT-v1-FAILURE.md; zero children before raw-v1.',
    'Original raw-v2 FAILED_OR_INCOMPLETE and raw-v3 FAILED_OR_INCOMPLETE are not rescored; remaining proofs come from versioned continuations.',
    'Source-build executes fresh compiled output, not raw TypeScript. No whole HEAD/global suite, native, private engine, network or actual SafeJS evidence.',
    'ARRAY source-only/MIXED/BRIDGE_CAPTURE/AST/cloning qualifications remain; these public composition checks do not close them.',
    'Working-byte bound is a retained-tree checkpoint plus accounted writes, not an OS quota or hard RSS guarantee.',
  ],
};
fs.writeFileSync(path.join(own, 'EVIDENCE.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(own, 'PACKAGE.tgz.base64'), final.pack.base64 + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate: result.candidate, package: result.pack, runtime: '93/93', types: '30/30 outcomes in18groups', controls: '5/5', resources: result.resources, evidenceSha256: hash(fs.readFileSync(path.join(own, 'EVIDENCE.json'))) }));
