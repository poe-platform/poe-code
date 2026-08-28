import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inventory, regular, sha256, verifyTooling } from "../../../integration/owned-output-production-rebase/author-public/harness/common.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(path.join(directory, "FD1-INPUTS.json"), "utf8"));
export function verifyBoundRecipe() {
  for (const entry of configuration.recipeInputs) assert.equal(sha256(regular(entry.filename)), entry.sha256, entry.filename);
  for (const entry of configuration.generatedInputs) assert.equal(sha256(regular(path.join(directory, entry.name))), entry.sha256, entry.name);
  return { commit: configuration.recipeCommit, manifestSha256: configuration.recipeManifestSha256,
    binding: "fd1 selected reconstruction; unchanged 25 semantic fixtures and child assessment", sourceOrigin: configuration.sourceOrigin };
}
export function verifyPublicBinding(binding) {
  verifyBoundRecipe();
  verifyTooling();
  assert.deepEqual(binding, configuration.binding);
  assert.equal(sha256(regular(binding.nodePath)), binding.nodeSha256);
  assert.equal(sha256(regular(binding.tarballPath)), binding.tarballSha256);
  assert.equal(sha256(regular(binding.archivePath)), binding.archiveSha256);
  assert.deepEqual(inventory(binding.productRoot), configuration.productEntries);
  assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries);
  assert.deepEqual(inventory(binding.compilerRoot), binding.compilerEntries);
  return { sourceOrigin: configuration.sourceOrigin, candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree,
    identityQualification: "Synthetic Git snapshot of exactly the selected 254 product inputs, not whole fd1 HEAD",
    sourceManifestSha256: binding.sourceManifestSha256, archiveSha256: binding.archiveSha256,
    tarballSha256: binding.tarballSha256, packageManifestSha256: sha256(JSON.stringify(binding.packageEntries)),
    selectedInputTreeUnchanged: true, newEntriesChecked: true };
}
