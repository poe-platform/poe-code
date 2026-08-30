import assert from 'node:assert/strict';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, jsonHash, regularBytes, sha256, verifyGuards } from './integrity.mjs';
import { loadData, materializeJobs } from './fixtures.mjs';
import { validateBounds } from './host.mjs';

const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const length = '74361026502d76b8c2b696f9c60e410ac9b78d95';
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function authorize({ authorizationPath, authorizationSha256, sealPath, sealSha256 }) {
  assert(authorizationPath && digest(authorizationSha256) && sealPath && digest(sealSha256), 'Missing explicit candidate authorization: no product imports or output admitted');
  const authBytes = regularBytes(authorizationPath, 1048576);
  assert.equal(sha256(authBytes), authorizationSha256, 'Root-supplied authorization hash');
  const authorization = JSON.parse(authBytes);
  assert.equal(authorization.schemaVersion, 1);
  assert.equal(authorization.purpose, 'YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF');
  assert(typeof authorization.rootApproval === 'string' && authorization.rootApproval.length > 0);
  assert(commit(authorization.candidateCommit), 'Exact immutable candidate commit required');
  assert.equal(authorization.baselineCommit, baseline);
  assert.equal(authorization.acceptedLengthCommit, length);
  assert.equal(authorization.contractCommit, 'bd471ef682d768692a682d40009a874f51e3ad68');
  assert.equal(authorization.independentReviewCommit, 'de89e478d8ddce62eac955708f1b87d7be1bd137');
  const recipeRoot = dirname(fileURLToPath(import.meta.url));
  assert.equal(authorization.recipe.root, recipeRoot, 'No relocated/live recipe fallback');
  assert.equal(authorization.recipe.sealSha256, sealSha256);
  const sealBytes = regularBytes(sealPath, 1048576);
  assert.equal(sha256(sealBytes), sealSha256);
  const seal = JSON.parse(sealBytes);
  assert.equal(seal.schemaVersion, 1);
  assert.equal(seal.kind, 'YQ_DEFERRED_EXECUTOR_RECIPE');
  assert.equal(authorization.recipe.treeSha256, seal.treeSha256);
  const guards = [{ kind: 'tree', path: recipeRoot, sha256: seal.treeSha256 }];
  for (const key of ['source', 'compiled']) {
    const binding = authorization[key];
    assert(isAbsolute(binding.root) && digest(binding.treeSha256));
    assert(!inside(recipeRoot, binding.root) && !inside(binding.root, recipeRoot), 'Candidate/recipe roots overlap');
    guards.push({ kind: 'tree', path: binding.root, sha256: binding.treeSha256 });
  }
  assert(!inside(authorization.source.root, authorization.compiled.root) && !inside(authorization.compiled.root, authorization.source.root), 'Source/compiled roots must be distinct');
  for (const [path, hash] of [[authorizationPath, authorizationSha256], [sealPath, sealSha256]]) {
    guards.push({ kind: 'file', path: resolve(path), sha256: hash, mode: 0o644 });
  }
  const provenance = authorization.source.provenance;
  assert(isAbsolute(provenance.path) && digest(provenance.sha256));
  const provenanceBytes = regularBytes(provenance.path, 1048576);
  assert.equal(sha256(provenanceBytes), provenance.sha256, 'Accepted source composition receipt');
  const composition = JSON.parse(provenanceBytes);
  assert.equal(composition.candidateCommit, authorization.candidateCommit);
  assert.equal(composition.baselineCommit, baseline);
  assert.equal(composition.acceptedLengthCommit, length);
  assert.equal(composition.sourceTreeSha256, authorization.source.treeSha256);
  assert.equal(composition.compiledTreeSha256, authorization.compiled.treeSha256);
  assert.equal(composition.rootAcceptedComposition, true, 'Source composition must already have independent root acceptance');
  assert(digest(composition.buildReceiptSha256), 'Materialization/build provenance receipt hash required');
  assert(Array.isArray(composition.newPaths) && composition.newPaths.length > 0);
  assert.equal(new Set(composition.newPaths).size, composition.newPaths.length);
  assert(composition.newPaths.every((path) => /^src\/commands\/yq\/[A-Za-z0-9_./-]+$/.test(path) || path === 'src/commands/structured/query-core.ts'));
  assert(composition.newPaths.every((path) => !path.split('/').includes('..')));
  guards.push({ kind: 'file', path: provenance.path, sha256: provenance.sha256, mode: 0o644 });
  const entry = authorization.compiled.entry;
  assert.equal(entry.proofRole, 'direct-compiled-factory-handler-not-public-package', 'Consumer binding pending; cannot claim package exports');
  assert.equal(entry.exportName, 'createYqCommand');
  assert(!isAbsolute(entry.path) && digest(entry.sha256));
  const entryPath = resolve(authorization.compiled.root, entry.path);
  assert(inside(authorization.compiled.root, entryPath) && ['.js', '.mjs'].includes(extname(entryPath)));
  assert.equal(sha256(regularBytes(entryPath)), entry.sha256, 'Exact compiled API entry');
  assert(isAbsolute(authorization.node.path) && digest(authorization.node.sha256));
  assert.equal(sha256(regularBytes(authorization.node.path, 134217728)), authorization.node.sha256, 'Pinned Node executable');
  assert.equal(authorization.node.path, process.execPath, 'Run the host with the authorized Node binary');
  assert(Number.isInteger(authorization.node.mode));
  guards.push({ kind: 'file', path: authorization.node.path, sha256: authorization.node.sha256, mode: authorization.node.mode, maximumBytes: 134217728 });
  validateBounds(authorization.bounds);
  assert(isAbsolute(authorization.frozenRepository));
  const data = loadData(recipeRoot, authorization.frozenRepository);
  for (const scope of data.bindings.scopes) guards.push({ kind: 'tree', path: join(authorization.frozenRepository, scope.path), sha256: jsonHash(scope.entries) });
  for (const binding of data.bindings.bindings) guards.push({ kind: 'file', path: join(authorization.frozenRepository, binding.path), sha256: binding.sha256, mode: binding.mode });
  const jobs = materializeJobs(data, authorization.selection.ids);
  assert.equal(jsonHash(jobs), authorization.selection.jobsSha256, 'Exact selected materialized job recipe hash');
  assert(jobs.length <= authorization.bounds.maximumJobs);
  assert(isAbsolute(authorization.evidenceParent));
  verifyGuards(guards);
  return { authorization, guards, jobs, data, entryPath, recipeRoot };
}
