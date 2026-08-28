import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hash, save } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';

export async function candidateGuards(stage, manifest, manifestPath, flags, env, worker, execute) {
  const rows = [
    ['manifest-digest', /bound bytes/u], ['manifest-missing', /ENOENT/u],
    ['node-path', /actual child binary/u], ['node-hash', /bound bytes/u], ['node-version', /strictly equal/u],
    ['kind-candidate', /manifest kind/u], ['composition', /strictly equal/u], ['package-digest', /strictly equal/u],
    ['module-missing', /ENOENT/u], ['module-tamper', /bound bytes/u], ['declaration-tamper', /bound bytes/u],
    ['unbound-overlay', /exact tree membership/u], ['module-symlink', /no symlink\/alias/u], ['required-file', /required member/u],
  ];
  const results = [];
  for (const [id, diagnostic] of rows) {
    const next = structuredClone(manifest), target = join(stage.work, 'candidate-guard-' + id + '.json');
    const module = id === 'declaration-tamper' ? manifest.rootDeclaration : manifest.runtimeModule;
    let restore = () => {};
    if (['module-missing', 'module-tamper', 'declaration-tamper', 'module-symlink'].includes(id)) {
      const original = readFileSync(module), entry = manifest.trees.find(tree => module.startsWith(tree.root + '/')).files[module.slice(manifest.packageRoot.length + 1)];
      restore = () => { try { unlinkSync(module); } catch (error) { if (error.code !== 'ENOENT') throw error; } writeFileSync(module, original); chmodSync(module, entry.mode); };
      if (id === 'module-missing') unlinkSync(module);
      else if (id === 'module-symlink') { unlinkSync(module); symlinkSync(manifest.rootModule, module); }
      else writeFileSync(module, Buffer.concat([original, Buffer.from('\n ')]));
    }
    if (id === 'unbound-overlay') { const extra = join(manifest.packageRoot, 'unbound.mjs'); writeFileSync(extra, 'throw new Error("must not execute");\n', { flag: 'wx' }); restore = () => unlinkSync(extra); }
    if (id === 'node-path') next.node.path += '.different';
    if (id === 'node-hash') next.node.sha256 = '0'.repeat(64);
    if (id === 'node-version') next.node.version = 'v0.0.0';
    if (id === 'kind-candidate') next.kind = 'dotglob-stack-baseline-calibration-v1';
    if (id === 'composition') next.acceptedComposition = '0'.repeat(40);
    if (id === 'package-digest') next.packageSha256 = '0'.repeat(64);
    if (id === 'required-file') next.requiredFiles.push(join(manifest.packageRoot, 'dist/missing.js'));
    try {
      if (id !== 'manifest-missing') save(target, next);
      const digest = ['manifest-missing', 'manifest-digest'].includes(id) ? '0'.repeat(64) : hash(readFileSync(target));
      const run = await execute('guard', [...flags, `--allow-fs-read=${target}`, worker, 'commands', '0', '1'], { cwd: manifest.harnessRoot, env: { ...env, DOTGLOB_MANIFEST: target, DOTGLOB_MANIFEST_SHA256: digest } });
      const accepted = run.code === 78 && diagnostic.test(run.stdout + run.stderr) && !run.stdout.includes('"load":') && !run.stdout.includes('"observation":');
      results.push({ id, expected: { code: 78, diagnostic: diagnostic.source }, accepted, run });
    } finally { restore(); }
    for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  }
  return results;
}
