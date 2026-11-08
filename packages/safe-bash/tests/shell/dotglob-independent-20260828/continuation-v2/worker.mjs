import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readLoadManifest, assertInventory, digestFile } from '../execution-prep-v1/admission.mjs';
import { installGuard } from '../execution-prep-v1/guard.mjs';
import { emit, executeRows } from '../execution-prep-v1/settlement.mjs';
import { sourceDelta, acceptedComposition } from '../execution-v2/guards.mjs';
import { correctedRow, matrix, packSha256, verifyR24 } from './proof.mjs';
try {
  const loaded = readLoadManifest(process.env.DOTGLOB_MANIFEST, process.env.DOTGLOB_MANIFEST_SHA256, 'dotglob-continuation-load-v1');
  const { manifest, allowed } = loaded;
  assert.equal(manifest.candidate, 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a');
  assert.equal(manifest.acceptedComposition, acceptedComposition); assert.equal(manifest.packageSha256, packSha256);
  assert.equal(manifest.rootAuthorizedCandidate, manifest.candidate);
  const binding = JSON.parse(readFileSync(new URL('../stack-binding-v1/BINDING.json', import.meta.url)));
  assert.deepEqual(sourceDelta(binding, manifest.candidateInputs), ['src/shell/runtime.ts', 'src/shell/shell.ts']);
  assert.equal(manifest.candidateInputs.find(row => row.path === 'src/shell/runtime.ts').blob, '69125acc1d3afefcaeba642e71539ab0cc40e055');
  assert.equal(manifest.candidateInputs.find(row => row.path === 'src/shell/shell.ts').blob, '220d6c28a6e50f459a48aaee2030f24a841f4ab7');
  assert.ok(allowed.has(manifest.boundary.path));
  assert.equal(digestFile(manifest.boundary.path, manifest.boundary.sha256).toString(), '{"private":true,"type":"module"}\n', 'isolated private ESM boundary');
  for (const filename of [manifest.rootModule, manifest.runtimeModule, manifest.contractsModule, manifest.patternModule, manifest.rootDeclaration]) assert.ok(allowed.has(filename));
  installGuard(loaded);
  if (process.argv[2] === 'source-denial') await import(pathToFileURL(manifest.forbiddenSource).href);
  const rootURL = manifest.layout === 'source' ? pathToFileURL(manifest.rootModule).href : import.meta.resolve('virtual-bash');
  const contractsURL = manifest.layout === 'source' ? pathToFileURL(manifest.contractsModule).href : import.meta.resolve('virtual-bash/contracts');
  assert.equal(rootURL, manifest.expectedRootURL, 'resolved public root must be the controlled package');
  assert.equal(contractsURL, pathToFileURL(manifest.contractsModule).href, 'resolved contracts must share package');
  emit({ diagnostic: { role: 'public-resolution-before-import', rootURL, contractsURL, boundary: manifest.boundary, node: process.execPath, version: process.version } });
  const api = await import(rootURL), contracts = await import(contractsURL);
  assert.equal(api.FsError, contracts.FsError);
  const { Runtime } = await import(pathToFileURL(manifest.runtimeModule).href);
  assert.deepEqual(api.createAgentCommands().map(row => row.name).sort(), binding.defaultNames);
  if (manifest.mutant?.id === 'accepted-stack-reversion') {
    const dispatch = Runtime.prototype.dispatch;
    Runtime.prototype.dispatch = function(name, ...args) { if (name === 'shopt') emit({ activation: { id: manifest.mutant.id, hits: 1 } }); return dispatch.call(this, name, ...args); };
  }
  const id = process.argv[2];
  if (id === 'G039-v2') {
    const { globCase } = await import('../execution-prep-v1/cohorts.mjs');
    await executeRows([correctedRow()], (row, resources) => globCase(api, row, resources));
  } else if (id === 'R24-v2') {
    await executeRows([{ id }], async () => verifyR24(manifest));
  } else {
    assert.ok(matrix.some(([, predicate]) => predicate === id), 'only frozen narrow predicates admitted');
    const { cases } = await import('../execution-prep-v1/plan.mjs');
    if (id.startsWith('R')) {
      const { adapters } = await import('../execution-v2/adapters.mjs');
      const { procedureCase } = await import('../execution-prep-v1/procedures.mjs');
      const row = cases().procedures.find(row => row.id === id); assert.ok(row);
      await executeRows([row], (row, resources) => procedureCase(adapters, row, resources, { api, Runtime, manifest }));
    } else {
      const { commandCase } = await import('../execution-prep-v1/cohorts.mjs');
      const row = cases().unsupported.find(row => row.id === id); assert.ok(row);
      await executeRows([row], (row, resources) => commandCase(api, row, resources));
    }
  }
  for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  if (process.env.DOTGLOB_LATE_EXIT_CONTROL === '7') process.exitCode = 7;
} catch (error) {
  emit({ diagnostic: { message: String(error?.stack ?? error), code: error?.code ?? null, resource: error?.resource ?? null, permission: error?.permission ?? null } });
  process.exitCode = 78;
}
