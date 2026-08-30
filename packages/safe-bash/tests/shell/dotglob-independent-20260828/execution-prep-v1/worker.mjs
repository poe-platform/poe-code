import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readLoadManifest, refuse } from './admission.mjs';
import { installGuard } from './guard.mjs';
import { emit, executeRows } from './settlement.mjs';

try {
  if (!process.env.DOTGLOB_MANIFEST || !process.env.DOTGLOB_MANIFEST_SHA256) refuse('accepted product manifest HELD');
  const loaded = readLoadManifest(process.env.DOTGLOB_MANIFEST, process.env.DOTGLOB_MANIFEST_SHA256, 'dotglob-product-load-v1');
  const { manifest, allowed } = loaded;
  assert.match(manifest.acceptedStack ?? '', /^[a-f0-9]{40}$/u);
  assert.match(manifest.candidate ?? '', /^[a-f0-9]{40}$/u);
  for (const path of [manifest.rootModule, manifest.runtimeModule, manifest.rootDeclaration]) assert.ok(allowed.has(path), 'required product module/declaration binding');
  installGuard(loaded);
  const api = await import(pathToFileURL(manifest.rootModule).href);
  await import(pathToFileURL(manifest.runtimeModule).href);
  const { cases } = await import('./plan.mjs');
  const { commandCase, globCase, stateCase } = await import('./cohorts.mjs');
  const cohort = process.argv[2];
  const all = cases();
  assert.ok(Object.hasOwn(all, cohort), 'known cohort');
  const first = Number(process.argv[3] ?? 0), count = Number(process.argv[4] ?? all[cohort].length);
  assert.ok(Number.isSafeInteger(first) && first >= 0 && Number.isSafeInteger(count) && count > 0 && first + count <= all[cohort].length);
  const rows = all[cohort].slice(first, first + count);
  if (cohort === 'procedures') {
    const { loadAdapters, procedureCase } = await import('./procedures.mjs');
    const adapters = await loadAdapters(manifest.procedures, allowed);
    await executeRows(rows, (row, resources) => procedureCase(adapters, row, resources, { api, manifest }));
  } else {
    const body = cohort === 'globs' ? globCase : cohort === 'states' ? stateCase : commandCase;
    await executeRows(rows, (row, resources) => body(api, row, resources));
  }
  for (const tree of manifest.trees) {
    const { assertInventory } = await import('./admission.mjs');
    assertInventory(tree.root, tree.files);
  }
  if (process.env.DOTGLOB_LATE_EXIT_CONTROL === '7') process.exitCode = 7;
} catch (error) {
  emit({ diagnostic: String(error?.stack ?? error) });
  process.exitCode = error?.exitCode ?? 78;
}
