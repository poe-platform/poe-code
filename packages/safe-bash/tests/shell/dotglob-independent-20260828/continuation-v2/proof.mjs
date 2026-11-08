import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { hash, packInventory } from '../execution-prep-v1/artifacts.mjs';
import { digestFile, assertInventory } from '../execution-prep-v1/admission.mjs';
import { cases } from '../execution-prep-v1/plan.mjs';
import { classify } from '../execution-prep-v1/protocol.mjs';
import { checkTypes, sourceDelta, packageDelta } from '../execution-v2/guards.mjs';
import { checkGuard } from './guards.mjs';
export const historySha256 = 'c0197514d7d10bb30a354065767f0383659f49bfaa3f0f6a71473ef128309fb9';
export const historyEncodedSha256 = 'c9c2b9545926fd3fd526e135c540eba91c325c4768939bcd66dfc4f362b2cf20';
export const packSha256 = 'b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa';
export const matrix = [
  ['absent-builtin', 'R01'], ['accepted-stack-reversion', 'R01'], ['M0', 'R08'], ['M1', 'R01'],
  ['M2', 'R26'], ['M3', 'R26'], ['M4', 'R04'], ['M5', 'R11'], ['M6', 'R10'], ['M7', 'N-off-3-0'], ['M8', 'R16'],
];
export const guardIds = ['missing-boundary', 'changed-boundary', 'module-tamper', 'module-symlink', 'package-overlay', 'wrong-node-hash', 'wrong-resolved-root', 'source-denial', 'late-exit-7'];
export function correctedRow() {
  const input = JSON.parse(readFileSync(new URL('./G039-v2.json', import.meta.url)));
  const original = cases().globs.find(row => row.id === 'G039');
  assert.deepEqual(input.original, original);
  assert.deepEqual(input.replacement, { ...original, id: 'G039-v2', expectedArgs: ['.x', '.雪'] });
  return input.replacement;
}
export function history(path) {
  const encoded = digestFile(path, historyEncodedSha256);
  const bytes = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(bytes.length, 54258326); assert.equal(hash(bytes), historySha256);
  return JSON.parse(bytes);
}
function clean(run, code = 0) {
  assert.equal(run.code, code); assert.equal(run.signal, null); assert.equal(run.spawnError, null); assert.equal(run.failure, null);
  assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
}
export function bindLoads(record, expectedIds) {
  const result = classify(record.run, expectedIds, { modulePath: record.runtimeModule, moduleSha256: record.runtimeSha256 });
  assert.ok(result.loads.some(row => row.path === record.rootModule && row.sha256 === record.rootSha256), 'actual root load');
  assert.ok(result.loads.some(row => row.path === record.contractsModule && row.sha256 === record.contractsSha256), 'actual public contracts load');
  return result;
}
export function checkMutant(record, members) {
  const expected = matrix.find(([id]) => id === record.id); assert.ok(expected);
  const ids = [expected[1]], mutant = record.mutant, restored = record.restored;
  assert.notEqual(mutant.runtimeSha256, members['dist/shell/runtime.js'].sha256);
  const classified = classify(mutant.run, ids, { modulePath: mutant.runtimeModule, moduleSha256: mutant.runtimeSha256, mutantId: record.id, requiredFailed: ids });
  assert.equal(classified.mutantKilled, true, 'real load, mechanism and exact failed predicate');
  bindLoads(mutant, ids);
  for (const row of classified.observations) { assert.match(row.error, /^AssertionError /u); assert.deepEqual(row.cleanupErrors, []); }
  assert.deepEqual(record.restoredInventory, members, 'all846 restored package bytes/modes');
  assert.equal(restored.runtimeSha256, members['dist/shell/runtime.js'].sha256);
  const positive = bindLoads(restored, ids); assert.equal(positive.accepted, true); assert.deepEqual(positive.activations, []);
  return { id: record.id, predicate: ids[0], killed: true, restored: true };
}
export function carried(old, binding) {
  assert.equal(old.accepted, false); assert.equal(old.binding.candidate, 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a');
  assert.equal(old.pack.sha256, packSha256); assert.equal(old.binding.acceptedComposition, binding.acceptedComposition);
  assert.deepEqual(old.binding.sourceBefore, old.sourceAfter);
  const layoutProofs = [];
  for (const layout of old.layouts) {
    assert.deepEqual(layout.before, layout.after);
    assert.equal(layout.runtimeSha256, old.pack.members['dist/shell/runtime.js'].sha256);
    assert.equal(layout.rootSha256, old.pack.members['dist/index.js'].sha256);
    assert.deepEqual(layout.defaultNames, binding.defaultNames); assert.deepEqual(layout.dependencies, {});
    if (layout.layout !== 'source') assert.deepEqual(layout.members, old.pack.members);
    for (const cohort of ['commands', 'unsupported', 'globs', 'states', 'overlay', 'procedures']) {
      const rows = layout.runs.filter(row => row.cohort === cohort), seen = [];
      for (const row of rows) {
        const result = classify(row.run, row.ids, { modulePath: layout.runtimeModule, moduleSha256: layout.runtimeSha256 });
        assert.equal(result.coherent, true);
        assert.deepEqual(result.failed, row.ids.includes('G039') ? ['G039'] : []);
        assert.ok(result.loads.some(entry => entry.path === layout.rootModule && entry.sha256 === layout.rootSha256));
        seen.push(...row.ids);
      }
      assert.deepEqual(seen.sort(), cases()[cohort].filter(row => row.id !== 'R24').map(row => row.id).sort());
    }
    clean(layout.sourceDenial.run, 78); assert.ok(layout.sourceDenial.run.stdout.includes('unbound module ' + layout.forbiddenSource));
    const late = classify(layout.late.run, layout.late.ids, { modulePath: layout.runtimeModule, moduleSha256: layout.runtimeSha256 });
    clean(layout.late.run, 7); assert.equal(late.passed, 1); assert.deepEqual(late.errors, ['exit status contradicts body outcomes']);
    layoutProofs.push(layout.layout);
  }
  assert.deepEqual(layoutProofs, ['source', 'installed', 'moved']);
  assert.equal(old.procedureR24.length, 1); assert.deepEqual(old.procedureR24[0].classification.failed, ['R24']);
  assert.equal(old.mutants.length, 11);
  for (const row of old.mutants) { clean(row.run, 78); assert.equal(row.classification.loads.length, 0); assert.equal(row.classification.mutantKilled, false); }
  checkTypes(old.types, old.layouts[2].packageRoot);
  assert.equal(old.guards.length, 14);
  for (const row of old.guards) { clean(row.run, 78); assert.equal(row.accepted, true); assert.ok(new RegExp(row.expected.diagnostic, 'u').test(row.run.stdout + row.run.stderr)); assert.equal(row.run.stdout.includes('"load":'), false); }
  assert.deepEqual(old.move.before, old.move.after); assert.equal(old.move.fromAbsent, true);
  assert.deepEqual(old.counts, { product: 183, guard: 17, type: 5, tool: 3 });
  for (const tool of old.tools) clean(tool.run);
  const oldR24 = classify(old.procedureR24[0].run, ['R24'], { modulePath: old.layouts[2].runtimeModule, moduleSha256: old.layouts[2].runtimeSha256 });
  assert.equal(oldR24.coherent, true); assert.deepEqual(oldR24.failed, ['R24']);
  return { roles: layoutProofs, typeChecks: 5, guardControls: 20, oldMutantKills: 0, oldChildren: 208, preservedFailure: 'G039/R24' };
}
export function verifyR24(manifest) {
  const proof = JSON.parse(digestFile(manifest.proof.path, manifest.proof.sha256));
  assert.equal(proof.kind, 'dotglob-R24-v2-local-plus-carried'); assert.equal(proof.layout, manifest.layout);
  assert.equal(proof.candidate, manifest.candidate); assert.equal(proof.packageSha256, packSha256);
  correctedRow();
  const binding = JSON.parse(readFileSync(new URL('../stack-binding-v1/BINDING.json', import.meta.url)));
  const old = history(manifest.historyPath), inherited = carried(old, binding);
  const packed = packageDelta(binding, digestFile(manifest.packPath, packSha256));
  assert.deepEqual(packed.members, old.pack.members);
  assert.deepEqual(sourceDelta(binding, proof.candidateInputs), ['src/shell/runtime.ts', 'src/shell/shell.ts']);
  assert.deepEqual(proof.candidateInputs, old.binding.candidateInputs);
  const sourceFiles = Object.fromEntries(proof.candidateInputs.map(row => [row.path, { sha256: row.sha256, bytes: row.bytes, mode: parseInt(row.mode, 8) & 0o777 }]));
  assertInventory(manifest.sourceRoot, sourceFiles);
  clean(proof.build.run); clean(proof.pack.run); assert.equal(proof.build.command, 'npm run build');
  assert.equal(proof.glob.layout, manifest.layout);
  assert.equal(proof.glob.runtimeSha256, packed.members['dist/shell/runtime.js'].sha256);
  const glob = bindLoads(proof.glob, ['G039-v2']); assert.equal(glob.accepted, true);
  assert.deepEqual(proof.glob.appBefore, proof.glob.appAfter);
  assert.deepEqual(proof.mutants.map(row => row.id), matrix.map(([id]) => id));
  const mutants = proof.mutants.map(row => checkMutant(row, packed.members));
  assert.deepEqual(proof.guards.map(row => row.id), guardIds);
  for (const guard of proof.guards) { assert.equal(guard.accepted, true); checkGuard(guard); }
  if (manifest.layout !== 'source') { clean(proof.install.run); assert.deepEqual(proof.install.args.slice(0, 5), ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']); }
  if (manifest.layout === 'moved') { assert.equal(proof.move.fromAbsent, true); assert.notEqual(proof.move.from, proof.move.to); assert.deepEqual(proof.move.before, proof.move.after); }
  return { version: 'R24-v2', layout: manifest.layout, inherited, actualLocalGlob: 'G039-v2', actualMutants: mutants, currentGuards: proof.guards.length, originalR24: 'failed and preserved', sourceInputs: 265, wholePack: 846, defaultNames: binding.defaultNames.length };
}
