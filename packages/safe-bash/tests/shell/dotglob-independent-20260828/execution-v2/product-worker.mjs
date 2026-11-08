import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readLoadManifest, assertInventory } from '../execution-prep-v1/admission.mjs';
import { installGuard } from '../execution-prep-v1/guard.mjs';
import { emit, executeRows } from '../execution-prep-v1/settlement.mjs';
import { acceptedComposition, sourceDelta } from './guards.mjs';

try {
  const loaded = readLoadManifest(process.env.DOTGLOB_MANIFEST, process.env.DOTGLOB_MANIFEST_SHA256, 'dotglob-product-load-v2');
  const { manifest, allowed } = loaded;
  assert.equal(manifest.acceptedComposition, acceptedComposition);
  assert.equal(manifest.candidate, 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a');
  assert.equal(manifest.packageSha256, 'b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa');
  assert.equal(manifest.rootAuthorizedCandidate, manifest.candidate, 'separately sealed root candidate GO required');
  assert.match(manifest.preparationRevision, /^[a-f0-9]{40}$/u);
  const binding = JSON.parse(readFileSync(new URL('../stack-binding-v1/BINDING.json', import.meta.url)));
  assert.deepEqual(sourceDelta(binding, manifest.candidateInputs), ['src/shell/runtime.ts', 'src/shell/shell.ts']);
  assert.equal(manifest.candidateInputs.find(row => row.path === 'src/shell/runtime.ts').blob, '69125acc1d3afefcaeba642e71539ab0cc40e055');
  assert.equal(manifest.candidateInputs.find(row => row.path === 'src/shell/shell.ts').blob, '220d6c28a6e50f459a48aaee2030f24a841f4ab7');
  for (const path of [manifest.rootModule, manifest.runtimeModule, manifest.patternModule, manifest.rootDeclaration]) assert.ok(allowed.has(path));
  assert.deepEqual(manifest.binding.defaultNames, binding.defaultNames);
  installGuard(loaded);
  if (process.argv[2] === 'source-denial') await import(pathToFileURL(manifest.forbiddenSource).href);
  const api = manifest.layout === 'source' ? await import(pathToFileURL(manifest.rootModule).href) : await import('virtual-bash');
  const { Runtime } = await import(pathToFileURL(manifest.runtimeModule).href);
  assert.deepEqual(api.createAgentCommands().map(command => command.name).sort(), binding.defaultNames);
  if (manifest.mutant?.id === 'accepted-stack-reversion') {
    const dispatch = Runtime.prototype.dispatch;
    Runtime.prototype.dispatch = function(name, ...args) {
      if (name === 'shopt') emit({ activation: { id: manifest.mutant.id, hits: 1 } });
      return dispatch.call(this, name, ...args);
    };
  }
  const { cases } = await import('../execution-prep-v1/plan.mjs');
  const { commandCase, globCase, stateCase } = await import('../execution-prep-v1/cohorts.mjs');
  const all = cases(), cohort = process.argv[2];
  assert.ok(Object.hasOwn(all, cohort));
  const first = Number(process.argv[3]), count = Number(process.argv[4]);
  assert.ok(Number.isSafeInteger(first) && first >= 0 && Number.isSafeInteger(count) && count > 0 && count <= 32 && first + count <= all[cohort].length);
  const rows = all[cohort].slice(first, first + count);
  if (cohort === 'procedures') {
    const { adapters } = await import('./adapters.mjs');
    const { validateAdapters, procedureCase } = await import('../execution-prep-v1/procedures.mjs');
    validateAdapters(adapters);
    await executeRows(rows, (row, resources) => procedureCase(adapters, row, resources, { api, Runtime, manifest }));
  } else {
    await executeRows(rows, (row, resources) => (cohort === 'globs' ? globCase : cohort === 'states' ? stateCase : commandCase)(api, row, resources));
  }
  for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  if (process.env.DOTGLOB_LATE_EXIT_CONTROL === '7') process.exitCode = 7;
} catch (error) { emit({ diagnostic: String(error?.stack ?? error) }); process.exitCode = 78; }
