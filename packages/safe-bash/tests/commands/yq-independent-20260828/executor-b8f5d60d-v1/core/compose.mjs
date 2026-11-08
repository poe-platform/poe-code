import { join } from 'node:path';
import { assertTree, atomicJson, canonical, canonicalPath, fileDigest, inside, readBoundJson, requireFact, snapshot } from './primitives.mjs';

export function composeRecipe({ coreRoot, coreSealPath, coreSealSha256, workerRoot, workerSealPath, workerSealSha256, outputPath }) {
  canonicalPath(coreRoot);
  canonicalPath(workerRoot);
  requireFact(!inside(coreRoot, outputPath) && !inside(workerRoot, outputPath), 'EXTERNAL_COMPOUND_RECIPE_REQUIRED');
  const coreSeal = readBoundJson(coreSealPath, coreSealSha256);
  const workerSeal = readBoundJson(workerSealPath, workerSealSha256);
  requireFact(coreSeal.kind === 'B8_EXECUTOR_CORE_SOURCE_SEAL' && workerSeal.candidate === coreSeal.candidate, 'COMPONENT_SEAL_SCHEMA');
  const complete = (root, seal, sealPath, sealHash) => {
    const files = Object.fromEntries(Object.entries(seal.files).map(([name, item]) => [name, { sha256: item.sha256, bytes: item.bytes, mode: item.mode }]));
    const self = seal.membership.self;
    requireFact(join(root, self) === sealPath && fileDigest(sealPath).sha256 === sealHash, 'SEAL_SELF_LOCATION');
    requireFact(fileDigest(sealPath).mode === seal.membership.selfMode, 'SEAL_SELF_MODE');
    files[self] = fileDigest(sealPath);
    const manifest = { files, directories: seal.directories };
    assertTree(root, manifest);
    return manifest;
  };
  const coreManifest = complete(coreRoot, coreSeal, coreSealPath, coreSealSha256);
  const workerManifest = complete(workerRoot, workerSeal, workerSealPath, workerSealSha256);
  requireFact(workerSealSha256 === coreSeal.peer.sha256 && coreSeal.peer.commit === 'c0353685540288d504b93f206735fe4c448268ef', 'EXACT_PEER_SEAL');
  const data = {};
  for (const name of coreSeal.dataNames) {
    const relativePath = `data/${name}.json`;
    data[name] = { path: join(coreRoot, relativePath), sha256: coreManifest.files[relativePath].sha256 };
  }
  data.typePlan = { path: join(workerRoot, 'TYPE-PLAN.json'), sha256: workerManifest.files['TYPE-PLAN.json'].sha256 };
  data.mutantPlan = { path: join(workerRoot, 'MUTANT-PLAN.json'), sha256: workerManifest.files['MUTANT-PLAN.json'].sha256 };
  data.toolSources = { path: join(coreRoot, 'TOOL-SOURCES.json'), sha256: coreManifest.files['TOOL-SOURCES.json'].sha256 };
  for (const [name, filename] of Object.entries({ cmd22Controls: 'DEFERRED-CONTROLS.json', cmd22Bases: 'CONTROL-BASES.json', cmd22Binding: 'cmd22-binding.json' })) data[name] = { path: join(coreRoot, 'frozen', filename), sha256: coreManifest.files[`frozen/${filename}`].sha256 };
  const jobs = readBoundJson(data.jobs.path, data.jobs.sha256);
  const phases = readBoundJson(data.phases.path, data.phases.sha256);
  requireFact(jobs.length === 336 && phases.reduce((sum, phase) => sum + phase.capMs, 0) === 24165000, 'COMPOUND_FINITE_SCHEDULE');
  const recipe = { schema: 1, interfaceVersion: 'yq-b8-core-worker-v1', candidate: coreSeal.candidate, activeRoots: [{ root: coreRoot, manifest: coreManifest }, { root: workerRoot, manifest: workerManifest }], data, dispatch: { build: join(coreRoot, 'build-stage.mjs'), types: join(workerRoot, 'type-worker.mjs'), loaded: join(workerRoot, 'loaded-worker.mjs'), semantic: join(coreRoot, 'semantic-worker.mjs'), sourceAudit: join(coreRoot, 'source-audit-worker.mjs'), infrastructure: join(coreRoot, 'infrastructure-worker.mjs') }, jobs, phases, closureComplete: true, workerSeal: { path: workerSealPath, sha256: workerSealSha256 }, coreSeal: { path: coreSealPath, sha256: coreSealSha256 } };
  return { ...atomicJson(outputPath, recipe), recipe, executionAuthorized: false, RootGO: false };
}
