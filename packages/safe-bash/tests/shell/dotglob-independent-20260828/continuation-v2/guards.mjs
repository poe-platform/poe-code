import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { inventory } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';
import { saveManifest } from './stage.mjs';
import { classify } from '../execution-prep-v1/protocol.mjs';
export function checkGuard(record) {
  const { run, id, expected } = record;
  assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true); assert.equal(run.failure, null); assert.equal(run.spawnError, null); assert.equal(run.signal, null);
  assert.equal(run.code, expected.code);
  if (id === 'late-exit-7') {
    const classified = classify(run, ['G039-v2'], { modulePath: record.runtimeModule, moduleSha256: record.runtimeSha256 });
    assert.equal(classified.passed, 1); assert.equal(classified.observed, 1); assert.deepEqual(classified.errors, ['exit status contradicts body outcomes']);
  } else {
    assert.ok(new RegExp(expected.diagnostic, 'u').test(run.stdout + run.stderr), 'specific admission rejection');
    assert.equal(run.stdout.includes('"load":'), false, 'refusal before product load');
    assert.equal(run.stdout.includes('"observation":'), false);
  }
  return true;
}
export async function runGuards(stage, base, invoke, results) {
  const variants = [
    ['missing-boundary', 'ENOENT'], ['changed-boundary', 'bound bytes'], ['module-tamper', 'bound bytes'],
    ['module-symlink', 'no symlink/alias'], ['package-overlay', 'exact tree membership'],
    ['wrong-node-hash', 'bound bytes'], ['wrong-resolved-root', 'resolved public root must be the controlled package'],
    ['source-denial', 'unbound module'], ['late-exit-7', 'exit status contradicts body outcomes'],
  ];
  for (const [id, diagnostic] of variants) {
    const manifest = structuredClone(base.manifest), appBefore = inventory(manifest.appRoot);
    let restore = () => {};
    const filename = id.includes('boundary') ? manifest.boundary.path : manifest.runtimeModule;
    if (['missing-boundary', 'changed-boundary', 'module-tamper', 'module-symlink'].includes(id)) {
      const bytes = readFileSync(filename);
      const root = manifest.trees.find(tree => filename.startsWith(tree.root + '/'));
      const mode = root.files[filename.slice(root.root.length + 1)].mode;
      restore = () => { try { unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; } writeFileSync(filename, bytes); chmodSync(filename, mode); };
      if (id === 'missing-boundary') unlinkSync(filename);
      else if (id === 'module-symlink') { unlinkSync(filename); symlinkSync(manifest.rootModule, filename); }
      else writeFileSync(filename, Buffer.concat([bytes, Buffer.from('\n ')]));
    }
    if (id === 'package-overlay') { const filename = join(manifest.packageRoot, 'unbound-control.mjs'); writeFileSync(filename, 'throw new Error("must not load");\n', { flag: 'wx' }); restore = () => unlinkSync(filename); }
    if (id === 'wrong-node-hash') manifest.node.sha256 = '0'.repeat(64);
    if (id === 'wrong-resolved-root') manifest.expectedRootURL += '?wrong-controlled-package';
    try {
      const bound = saveManifest(stage, 'guard-' + id, manifest);
      if (id === 'late-exit-7') bound.env.DOTGLOB_LATE_EXIT_CONTROL = '7';
      const run = await invoke('guard', bound, id === 'source-denial' ? 'source-denial' : 'G039-v2', { expectedGuard: true });
      const record = { id, expected: { code: id === 'late-exit-7' ? 7 : 78, diagnostic }, run, runtimeModule: base.manifest.runtimeModule, runtimeSha256: base.manifest.trees[0].files['dist/shell/runtime.js'].sha256, accepted: false };
      results.push(record);
      record.accepted = checkGuard(record);
    } finally { restore(); }
    assert.deepEqual(inventory(manifest.appRoot), appBefore, 'guard exact app restoration');
    for (const tree of base.manifest.trees) assertInventory(tree.root, tree.files);
  }
}
