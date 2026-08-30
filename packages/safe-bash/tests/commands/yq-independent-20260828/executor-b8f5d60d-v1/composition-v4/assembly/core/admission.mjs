import { dirname, join, resolve } from 'node:path';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { CANDIDATE, assertTree, canonical, canonicalPath, fileDigest, inside, keys, readBoundJson, readRegular, requireFact, safeRelative } from './primitives.mjs';

function guardPhysicalContainer(physical, admitted) {
  canonicalPath(physical.root);
  requireFact((lstatSync(physical.root).mode & 4095) === 493, 'PHYSICAL_CONTAINER_MODE');
  requireFact(canonical(readdirSync(physical.root).sort()) === canonical(admitted ? ['execution', 'inputs', 'tools'] : ['inputs', 'tools']), 'PHYSICAL_CONTAINER_ADDED_MEMBERSHIP');
  assertTree(physical.inputRoot, physical.inputManifest);
}

export function validateEnvelope(root, recipe, recipePath, evidenceRoot) {
  keys(root, ['schema', 'purpose', 'RootGO', 'candidate', 'runId', 'evidenceRoot', 'recipeSha256', 'toolchain', 'archives', 'repository', 'bindings', 'controlEnrollments', 'reviewSeals', 'legacyHistorical']);
  requireFact(root.schema === 1 && root.purpose === 'YQ_B8_SUCCESSOR_SINGLE_COHORT' && root.RootGO === true && root.candidate === CANDIDATE, 'ROOT_GO_DENIED');
  keys(root.bindings, []);
  requireFact(typeof root.runId === 'string' && /^[A-Za-z0-9-]{16,80}$/u.test(root.runId) && root.evidenceRoot === evidenceRoot, 'ONE_USE_EVIDENCE_BINDING');
  keys(recipe, ['schema', 'interfaceVersion', 'candidate', 'activeRoots', 'data', 'dispatch', 'jobs', 'phases', 'closureComplete', 'workerSeal', 'coreSeal']);
  requireFact(recipe.schema === 1 && recipe.interfaceVersion === 'yq-b8-composition-v2' && recipe.candidate === CANDIDATE && recipe.closureComplete === true && recipe.workerSeal && recipe.coreSeal, 'RECIPE_INCOMPLETE');
  const physical = readBoundJson(recipe.data.physicalBindings.path, recipe.data.physicalBindings.sha256);
  requireFact(root.repository === physical.repository && evidenceRoot === physical.evidenceRoot && canonical(root.toolchain) === canonical(physical.toolchain) && canonical(root.archives) === canonical(physical.archives), 'FIXED_PHYSICAL_RECIPE_BINDING');
  requireFact(canonical(root.legacyHistorical) === canonical(physical.legacyHistorical), 'HISTORICAL_CONTENT_ONLY_ROLE_BINDING');
  assertTree(physical.inputRoot, physical.inputManifest);
  guardPhysicalContainer(physical, false);
  requireFact(Array.isArray(root.reviewSeals) && root.reviewSeals.length > 0 && root.reviewSeals.every(entry => entry.role && /^[0-9a-f]{64}$/u.test(entry.sha256)), 'REVIEW_SEALS_REQUIRED');
  requireFact(root.reviewSeals.some(seal => seal.role === 'independent-composition-review'), 'INDEPENDENT_COMPOSITION_REVIEW_REQUIRED');
  for (const seal of root.reviewSeals) { keys(seal, ['role', 'path', 'sha256']); const actual = fileDigest(seal.path); requireFact(actual.sha256 === seal.sha256 && actual.mode === 420, 'REVIEW_SEAL_BYTES_MODE'); }
  requireFact(Array.isArray(root.legacyHistorical) && root.legacyHistorical.every(entry => entry.classification === 'ORIGINAL_MODE_UNATTESTED' && entry.activeAuthority === false && entry.executed === false && /^[0-9a-f]{64}$/u.test(entry.sha256)), 'LEGACY_ROLE');
  requireFact(Array.isArray(recipe.activeRoots) && recipe.activeRoots.length >= 1, 'ACTIVE_CLOSURE');
  requireFact(recipe.activeRoots.length === 1 && canonical(recipe.coreSeal) === canonical(recipe.workerSeal), 'SINGLE_FRESH_UNION_SEAL');
  keys(recipe.coreSeal, ['path', 'sha256']);
  const union = readBoundJson(recipe.coreSeal.path, recipe.coreSeal.sha256);
  requireFact(fileDigest(recipe.coreSeal.path).mode === 420 && union.kind === 'B8_COMPOSITION_V2_ASSEMBLY_SEAL' && union.root === recipe.activeRoots[0].root && canonical(union.manifest) === canonical(recipe.activeRoots[0].manifest), 'FRESH_UNION_MANIFEST');
  for (const entry of recipe.activeRoots) { keys(entry, ['root', 'manifest']); assertTree(entry.root, entry.manifest); }
  for (const descriptor of Object.values(recipe.data)) {
    keys(descriptor, ['path', 'sha256']);
    requireFact(Object.entries(union.manifest.files).some(([relative, file]) => join(union.root, relative) === descriptor.path && file.sha256 === descriptor.sha256), 'DATA_OUTSIDE_FRESH_UNION');
  }
  requireFact(recipe.activeRoots.every(entry => !inside(entry.root, recipePath)), 'RECIPE_MUST_BE_EXTERNAL_TO_CODE_CLOSURE');
  requireFact(!existsSync(evidenceRoot), 'EVIDENCE_EXISTS');
  canonicalPath(dirname(evidenceRoot));
  for (const entry of [...recipe.activeRoots, { root: root.toolchain.root }, ...root.archives.map(archive => ({ root: dirname(archive.path) }))]) requireFact(!inside(entry.root, evidenceRoot) && !inside(evidenceRoot, entry.root), 'EVIDENCE_NOT_DISJOINT');
  keys(root.toolchain, ['root', 'manifest', 'node', 'git', 'typescript', 'nodeTypes', 'undiciTypes', 'versions']);
  assertTree(root.toolchain.root, root.toolchain.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
  const sealedTools = readBoundJson(recipe.data.toolSources.path, recipe.data.toolSources.sha256);
  requireFact(canonical(root.toolchain.manifest) === canonical(sealedTools.expectedCopyManifest), 'EXACT_COPIED_TOOL_MAP');
  for (const [name, location] of Object.entries(sealedTools.copiedRelative)) requireFact(root.toolchain[name] === location, 'EXACT_COPIED_TOOL_PATH');
  for (const key of ['node', 'git', 'typescript', 'nodeTypes', 'undiciTypes']) safeRelative(root.toolchain[key]);
  requireFact(root.toolchain.versions.node === 'v22.22.2' && root.toolchain.versions.typescript === '5.9.3', 'TOOL_PROFILE');
  requireFact(root.toolchain.manifest.files[root.toolchain.node]?.mode === 493 && root.toolchain.manifest.files[root.toolchain.git]?.mode === 493, 'EXECUTABLE_MODES');
  requireFact(fileDigest(process.execPath, 134217728).sha256 === root.toolchain.manifest.files[root.toolchain.node].sha256 && resolve(process.execPath) === join(root.toolchain.root, root.toolchain.node), 'COPIED_NODE_REQUIRED');
  for (const archive of root.archives) {
    keys(archive, ['name', 'path', 'descriptor']);
    requireFact(canonical(fileDigest(archive.path, 67108864)) === canonical(archive.descriptor), 'ARCHIVE_BINDING');
  }
  requireFact(root.archives.length === 2 && root.archives.find(entry => entry.name === 'source')?.descriptor.sha256 === 'fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878' && root.archives.find(entry => entry.name === 'package')?.descriptor.sha256 === '1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca', 'EXACT_ARCHIVES');
  canonicalPath(root.repository);
  canonicalPath(join(root.repository, '.git'));
  const gitConfig = readRegular(join(root.repository, '.git/config'), 65536).toString('utf8');
  requireFact(!/promisor|partialclone|\[include(?:if)?\b/iu.test(gitConfig) && !existsSync(join(root.repository, '.git/objects/info/alternates')), 'GIT_IMPLICIT_OBJECT_OR_CONFIG_SOURCE');
  requireFact(!inside(root.repository, evidenceRoot) && !inside(root.repository, root.toolchain.root), 'WORKSPACE_MATERIALIZATION_OR_TOOL_FALLBACK');
  requireFact(Array.isArray(root.controlEnrollments) && root.controlEnrollments.length === 3, 'MUTANT_ENROLLMENTS');
  return true;
}

export function readAdmission({ rootPath, rootHash, recipePath, recipeHash, evidenceRoot }) {
  requireFact(rootPath && rootHash && recipePath && recipeHash && evidenceRoot, 'MISSING_AUTHORIZATION');
  requireFact(fileDigest(rootPath).mode === 384 && fileDigest(recipePath).mode === 420, 'FRESH_RECEIPT_RECIPE_MODES');
  const root = readBoundJson(rootPath, rootHash);
  requireFact(root.RootGO === true && root.recipeSha256 === recipeHash, 'ROOT_GO_DENIED');
  const recipe = readBoundJson(recipePath, recipeHash);
  validateEnvelope(root, recipe, recipePath, evidenceRoot);
  return { root, recipe, rootPath, rootHash, recipePath, recipeHash, evidenceRoot };
}

export function guardAdmission(admission) {
  requireFact(fileDigest(admission.rootPath).mode === 384 && fileDigest(admission.recipePath).mode === 420, 'RECEIPT_RECIPE_MODE_CHANGED');
  readBoundJson(admission.rootPath, admission.rootHash);
  readBoundJson(admission.recipePath, admission.recipeHash);
  readBoundJson(admission.recipe.coreSeal.path, admission.recipe.coreSeal.sha256);
  requireFact(fileDigest(admission.recipe.coreSeal.path).mode === 420, 'UNION_SEAL_MODE_CHANGED');
  for (const entry of admission.recipe.activeRoots) assertTree(entry.root, entry.manifest);
  assertTree(admission.root.toolchain.root, admission.root.toolchain.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
  for (const archive of admission.root.archives) requireFact(canonical(fileDigest(archive.path, 67108864)) === canonical(archive.descriptor), 'ARCHIVE_CHANGED');
  for (const seal of admission.root.reviewSeals) { const actual = fileDigest(seal.path); requireFact(actual.sha256 === seal.sha256 && actual.mode === 420, 'REVIEW_SEAL_CHANGED'); }
  for (const data of Object.values(admission.recipe.data)) readBoundJson(data.path, data.sha256);
  const physical = readBoundJson(admission.recipe.data.physicalBindings.path, admission.recipe.data.physicalBindings.sha256);
  assertTree(physical.inputRoot, physical.inputManifest);
  guardPhysicalContainer(physical, true);
  return true;
}
