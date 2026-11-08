import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readLoadManifest, assertInventory } from '../execution-prep-v1/admission.mjs';
import { installGuard } from '../execution-prep-v1/guard.mjs';
import { executeRows, emit } from '../execution-prep-v1/settlement.mjs';

try {
  const loaded = readLoadManifest(process.env.DOTGLOB_MANIFEST, process.env.DOTGLOB_MANIFEST_SHA256, 'dotglob-stack-baseline-calibration-v1');
  const { manifest, allowed } = loaded;
  assert.equal(manifest.acceptedComposition, '099455f232870fa1ea59e1a0ae482e003fd170db');
  assert.equal(manifest.packageSha256, '15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18');
  assert.equal(manifest.dotglobCandidate, null, 'candidate remains held');
  installGuard(loaded);
  if (process.argv[2] === 'source-denial') await import(pathToFileURL(manifest.forbiddenSource).href);
  const api = await import('virtual-bash');
  const contracts = await import('virtual-bash/contracts');
  assert.equal(api.FsError, contracts.FsError);
  const { Runtime } = await import(pathToFileURL(manifest.runtimeModule).href);
  const { calibrationIds, calibrate } = await import('./calibration.mjs');
  const selected = process.argv[2] === 'smoke' ? calibrationIds.slice(0, 1) : calibrationIds;
  const observations = await executeRows(selected.map(id => ({ id })), (row, resources) => calibrate(row.id, resources, { api, Runtime, manifest, binding: manifest.binding }));
  for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  if (process.argv[3] === 'late-exit-7') process.exitCode = 7;
  emit({ diagnostic: { role: 'baseline calibration, not DOTGLOB product passes', observations: observations.length } });
} catch (error) {
  emit({ diagnostic: String(error?.stack ?? error) });
  process.exitCode = 78;
}
