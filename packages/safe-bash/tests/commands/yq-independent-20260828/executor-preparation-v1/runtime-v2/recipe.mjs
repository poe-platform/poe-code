import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyDelta, candidateCommit, contractCommit, version } from './delta.mjs';
import { authenticateFrozen, jsonHash, regularBytes, root, sha256 } from './frozen.mjs';

export function describeRecipe() {
  const frozen = authenticateFrozen();
  const files = applyDelta(frozen.original);
  const entries = frozen.seal.entries.map((entry) => entry.kind === 'directory' ? entry : { ...entry, bytes: files.get(entry.path).length, sha256: sha256(files.get(entry.path)) });
  const changes = entries.filter((entry) => entry.kind === 'file' && entry.sha256 !== frozen.seal.entries.find((original) => original.path === entry.path).sha256);
  assert.deepEqual(changes.map((entry) => entry.path), ['assert-capture.mjs', 'authorization.mjs', 'context.mjs', 'import-fence.mjs']);
  const seal = {
    schemaVersion: 1, kind: 'YQ_DEFERRED_EXECUTOR_RECIPE', version,
    state: 'SYNTHETIC_ONLY_NO_GO', candidateCommit, contractCommit,
    originalSourceCommit: frozen.bindings.runtimeSourceCommit,
    originalEvidenceCommit: frozen.bindings.runtimeEvidenceCommit,
    originalTreeSha256: frozen.seal.treeSha256,
    treeSha256: jsonHash(entries), entries,
    changes: changes.map((entry) => ({ path: entry.path, beforeSha256: frozen.seal.entries.find((original) => original.path === entry.path).sha256, afterSha256: entry.sha256 })),
    roleCounts: frozen.bindings.roleCounts, semanticPasses: 0, grantsGO: false,
  };
  return { frozen, files, seal };
}

export function materializeRecipe(destination) {
  const described = describeRecipe();
  const expected = JSON.parse(regularBytes(join(root, 'RECIPE-SEAL.json')));
  assert.deepEqual(described.seal, expected, 'Exact presealed v2 recipe');
  const recipeRoot = resolve(destination);
  assert.equal(realpathSync(dirname(recipeRoot)), dirname(recipeRoot), 'Canonical existing output parent');
  mkdirSync(recipeRoot, { mode: 0o755 });
  chmodSync(recipeRoot, 0o755);
  for (const [name, bytes] of described.files) {
    writeFileSync(join(recipeRoot, name), bytes, { flag: 'wx', mode: 0o644 });
    chmodSync(join(recipeRoot, name), 0o644);
  }
  verifyRecipe(recipeRoot);
  return { recipeRoot, seal: expected, sealSha256: sha256(regularBytes(join(root, 'RECIPE-SEAL.json'))), sealPath: join(root, 'RECIPE-SEAL.json') };
}

export function verifyRecipe(recipeRoot) {
  const { seal } = describeRecipe();
  assert.equal(realpathSync(recipeRoot), recipeRoot);
  assert.equal(lstatSync(recipeRoot).mode & 0o7777, 0o755);
  assert.deepEqual(readdirSync(recipeRoot).sort(), seal.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  for (const entry of seal.entries.filter((entry) => entry.kind === 'file')) {
    const filename = join(recipeRoot, entry.path);
    assert.equal(sha256(regularBytes(filename)), entry.sha256, `Recipe hash: ${entry.path}`);
    assert.equal(lstatSync(filename).mode & 0o7777, entry.mode);
  }
  return seal;
}
