import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hash, save } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';
import { supervise } from '../execution-prep-v1/protocol.mjs';

export async function baselineGuards(stage, flags, env, worker) {
  const rows = [
    ['manifest-digest', /bound bytes/u],
    ['manifest-missing', /ENOENT/u],
    ['node-path', /actual child binary/u],
    ['node-hash', /bound bytes/u],
    ['node-version', /strictly equal/u],
    ['kind-candidate', /manifest kind/u],
    ['composition', /strictly equal/u],
    ['package-digest', /strictly equal/u],
    ['module-missing', /ENOENT/u],
    ['module-tamper', /bound bytes/u],
    ['declaration-tamper', /bound bytes/u],
    ['unbound-overlay', /exact tree membership/u],
    ['module-symlink', /no symlink\/alias/u],
    ['required-file', /required member/u],
  ];
  const results = [];
  for (const [id, diagnostic] of rows) {
    const manifest = structuredClone(stage.manifest);
    const file = join(stage.work, 'guard-' + id + '.json');
    let restore = () => {};
    const module = join(stage.packageRoot, id === 'declaration-tamper' ? 'dist/index.d.ts' : 'dist/shell/runtime.js');
    if (['module-missing', 'module-tamper', 'declaration-tamper', 'module-symlink'].includes(id)) {
      const original = readFileSync(module), entry = stage.binding.package.members[module.slice(stage.packageRoot.length + 1)];
      restore = () => { try { unlinkSync(module); } catch (error) { if (error.code !== 'ENOENT') throw error; } writeFileSync(module, original); chmodSync(module, entry.mode); };
      if (id === 'module-missing') unlinkSync(module);
      else if (id === 'module-symlink') { unlinkSync(module); symlinkSync(join(stage.packageRoot, 'dist/index.js'), module); }
      else writeFileSync(module, Buffer.concat([original, Buffer.from('\n ')]));
    }
    if (id === 'unbound-overlay') { const path = join(stage.packageRoot, 'unbound.mjs'); writeFileSync(path, 'throw new Error("must not execute");\n', { flag: 'wx' }); restore = () => unlinkSync(path); }
    if (id === 'node-path') manifest.node.path += '.not-this-binary';
    if (id === 'node-hash') manifest.node.sha256 = '0'.repeat(64);
    if (id === 'node-version') manifest.node.version = 'v0.0.0';
    if (id === 'kind-candidate') manifest.kind = 'dotglob-product-load-v2';
    if (id === 'composition') manifest.acceptedComposition = '0'.repeat(40);
    if (id === 'package-digest') manifest.packageSha256 = '0'.repeat(64);
    if (id === 'required-file') manifest.requiredFiles.push(join(stage.packageRoot, 'dist/nonexistent.js'));
    try {
      if (id !== 'manifest-missing') save(file, manifest);
      const digest = id === 'manifest-missing' || id === 'manifest-digest' ? '0'.repeat(64) : hash(readFileSync(file));
      const run = await supervise(stage.binding.node.path, [...flags, `--allow-fs-read=${file}`, worker, 'smoke'], { cwd: stage.moved, env: { ...env, DOTGLOB_MANIFEST: file, DOTGLOB_MANIFEST_SHA256: digest }, timeoutMs: 10000, maxBytes: 1024 * 1024 });
      const accepted = run.code === 78 && !run.failure && run.closeObserved && run.groupAbsent && diagnostic.test(run.stdout + run.stderr) && !run.stdout.includes('"load":') && !run.stdout.includes('"observation":');
      results.push({ id, expected: { code: 78, diagnostic: diagnostic.source, beforeProductLoad: true }, accepted, run });
      if (run.failure || !run.closeObserved || !run.groupAbsent) throw Object.assign(new Error('guard resource/cleanup failure'), { infrastructureFailure: true, results });
    } finally { restore(); }
    assertInventory(stage.packageRoot, stage.binding.package.members);
  }
  return results;
}
