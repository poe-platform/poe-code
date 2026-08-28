import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, inventory, save } from '../execution-prep-v1/artifacts.mjs';
export const boundaryBytes = '{"private":true,"type":"module"}\n';
export function copyHarness(stage, appRoot) {
  const target = join(appRoot, 'harness');
  for (const [name, entry] of Object.entries(inventory(stage.harnessRoot))) {
    if (name.includes('/') && !['byte-overlay-v1/', 'execution-prep-v1/', 'execution-v2/', 'stack-binding-v1/', 'continuation-v2/'].some(prefix => name.startsWith(prefix))) continue;
    assert.equal(entry.link, undefined); assert.equal(name.split('/').includes('AGENTS.md'), false);
    const filename = join(target, name); mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, readFileSync(join(stage.harnessRoot, name)), { flag: 'wx' }); chmodSync(filename, entry.mode);
  }
  writeFileSync(join(target, 'package.json'), boundaryBytes, { flag: 'wx' });
  return target;
}
export function makeManifest(stage, revision, layout, appRoot, packageRoot, scratchRoot, extra = {}) {
  const harnessRoot = join(appRoot, 'harness'), rootModule = join(packageRoot, 'dist/index.js');
  const manifest = {
    kind: 'dotglob-continuation-load-v1', candidate: stage.candidate, rootAuthorizedCandidate: stage.candidate,
    acceptedComposition: stage.binding.acceptedComposition, packageSha256: stage.pack.sha256, candidateInputs: stage.candidateInputs,
    preparationRevision: revision, node: stage.binding.node, layout, appRoot, packageRoot, harnessRoot, scratchRoot,
    rootModule, rootDeclaration: join(packageRoot, 'dist/index.d.ts'), runtimeModule: join(packageRoot, 'dist/shell/runtime.js'),
    contractsModule: join(packageRoot, 'dist/contracts/index.js'), patternModule: join(packageRoot, 'dist/shell/pattern.js'),
    boundary: { path: join(harnessRoot, 'package.json'), sha256: hash(Buffer.from(boundaryBytes)) },
    expectedRootURL: pathToFileURL(rootModule).href, forbiddenSource: stage.manifest.forbiddenSource,
    trees: [{ root: packageRoot, files: inventory(packageRoot) }, { root: harnessRoot, files: inventory(harnessRoot) }],
    requiredFiles: [rootModule, join(packageRoot, 'dist/index.d.ts'), join(packageRoot, 'dist/shell/runtime.js'), join(harnessRoot, 'package.json')],
    binding: { defaultNames: stage.binding.defaultNames }, ...extra,
  };
  return manifest;
}
export function saveManifest(stage, label, manifest) {
  const path = join(stage.work, label + '.manifest.json'); save(path, manifest);
  const flags = ['--permission', ...manifest.trees.map(tree => `--allow-fs-read=${tree.root}`), `--allow-fs-read=${path}`, `--allow-fs-read=${manifest.node.path}`, `--allow-fs-read=${manifest.scratchRoot}`, `--allow-fs-write=${manifest.scratchRoot}`];
  const env = { PATH: dirname(manifest.node.path), LC_ALL: 'C', TZ: 'UTC', DOTGLOB_MANIFEST: path, DOTGLOB_MANIFEST_SHA256: hash(readFileSync(path)) };
  return { manifest, path, sha256: env.DOTGLOB_MANIFEST_SHA256, flags, env, worker: join(manifest.harnessRoot, 'continuation-v2/worker.mjs') };
}
