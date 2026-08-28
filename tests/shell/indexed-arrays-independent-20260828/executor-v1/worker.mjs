import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admit, guard, moduleURL, verifyTree } from './boundary.mjs';
import { semanticCase, literalCase, preabort, rhsAbort, overlayCases } from './semantic.mjs';

const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  const [manifestPath, manifestSha256, goPath, goSha256, cohort, idsJson] = process.argv.slice(2);
  assert.ok(manifestPath && manifestSha256 && goPath && goSha256 && cohort && idsJson, 'root GO and complete binding required');
  const bound = admit(manifestPath, manifestSha256, goPath, goSha256);
  const { manifest } = bound;
  const ids = JSON.parse(idsJson); assert.ok(Array.isArray(ids) && ids.length > 0 && ids.length <= 64 && new Set(ids).size === ids.length);
  const vectors = JSON.parse(readFileSync(manifest.vectorsFile));
  const holdouts = JSON.parse(readFileSync(manifest.holdoutsFile));
  const controls = JSON.parse(readFileSync(manifest.controlsFile));
  const available = cohort === 'semantic' ? [...vectors.splice, ...vectors.zeroView]
    : cohort === 'holdouts' ? holdouts.semantic.filter(row => !row.status)
    : cohort === 'operations' ? holdouts.operations
    : cohort === 'mechanical' ? controls.controls : [];
  assert.ok(ids.every(id => available.some(row => row.id === id)), 'known admitted IDs; H12 is held');
  const concreteOperations = ['P01', 'P02', 'P06', 'P07'];
  const needsAdapter = ids.some(id => id === 'O11' || id.startsWith('M') || id.startsWith('P') && !concreteOperations.includes(id));
  if (needsAdapter) assert.ok(manifest.adapter && bound.allowed.has(manifest.adapter.path), 'exact candidate mechanical/terminal observer binding required');
  const loads = guard(bound, emit);
  const api = await import('virtual-bash');
  assert.equal(loads.get(manifest.rootModule), bound.allowed.get(manifest.rootModule), 'actual public root import resolves to admitted package');
  await import(moduleURL(manifest.runtimeModule));
  const baseline = JSON.parse(readFileSync(manifest.baselineFile));
  const defaults = api.createAgentCommands().map(definition => definition.name).sort();
  assert.equal(defaults.length, 77); assert.deepEqual(defaults, [...baseline.defaultNames].sort());
  const adapter = needsAdapter ? await import(moduleURL(manifest.adapter.path)) : undefined;
  if (needsAdapter) {
    assert.equal(adapter.candidate, manifest.candidate);
    assert.ok(ids.filter(id => id === 'O11' || id.startsWith('M') || id.startsWith('P') && !concreteOperations.includes(id)).every(id => adapter.supportedIds.includes(id)), 'no missing adapter methods/stub fallback');
  }
  const failed = [];
  for (const id of ids) {
    const row = available.find(entry => entry.id === id);
    let pass = false; let detail; let category = 'actual-public-body';
    try {
      if (cohort === 'semantic') detail = await semanticCase(api, row, adapter);
      else if (cohort === 'holdouts') detail = await literalCase(api, row);
      else if (id === 'P01') detail = await preabort(api);
      else if (id === 'P02') detail = await rhsAbort(api);
      else if (id === 'P06') detail = await overlayCases(api, false);
      else if (id === 'P07') detail = await overlayCases(api, true);
      else {
        detail = await adapter.execute({ id, row, api, manifest, emit });
        assert.ok(['actual-candidate-mechanism', 'candidate-source-proof'].includes(detail.category));
        category = detail.category;
        assert.ok(Array.isArray(detail.requiredLoads) && detail.requiredLoads.length > 0);
        for (const required of detail.requiredLoads) assert.equal(loads.get(required.path), required.sha256, 'actual private product bytes loaded');
        assert.equal(detail.assertionsCompleted, true); assert.equal(detail.disposed, true);
      }
      pass = true;
    } catch (error) {
      if (error?.unsafe) throw error;
      detail = { error: String(error?.stack ?? error) }; failed.push(id);
    }
    emit({ observation: { id, category, pass, settled: true, disposed: true, detail } });
  }
  for (const tree of manifest.trees) verifyTree(tree);
  emit({ summary: { cases: ids.length, pass: ids.length - failed.length, failed } });
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  emit({ diagnostic: String(error?.stack ?? error) }); process.exitCode = 78;
}
