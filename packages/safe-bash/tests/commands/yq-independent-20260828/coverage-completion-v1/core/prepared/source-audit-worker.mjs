import { dataHash, requireFact } from './own-data.mjs';
import { readSelectedSources } from './source-files.mjs';
import { ingestSourceArguments } from './source-arguments.mjs';

export async function runWorker(api) {
  await api.phase('admission', { sourceOnly: true, productImport: false });
  await api.guard();
  const manifest = await api.readBoundJson('sourceManifest');
  const origins = await api.readBoundJson('sourceOrigins');
  const plan = await api.readBoundJson('sourceProofPlan');
  const allocation = await api.readBoundJson('coverageAllocation');
  const bundle = await api.readBoundJson('sourceArguments');
  requireFact(api.bindings.candidate === bundle.candidate, 'SOURCE_WORKER_CANDIDATE');
  const before = readSelectedSources(api.bindings.sourceRoot, manifest);
  await api.phase('operation', { operation: 'authenticated-source-argument-ingestion', targetExecution: false });
  const raw = await api.writeJson('source-arguments-raw.json', { schema: 1, candidate: api.bindings.candidate, observedSource: before.observed, origins, plan, bundle, allocationSha256: dataHash(allocation), productImports: 0 });
  let report;
  try {
    report = await ingestSourceArguments({ candidate: api.bindings.candidate, manifest, origins, plan, bundle, allocation, readSource: before.readSource });
  } catch (error) {
    try { await api.writeJson('source-argument-failure.json', { status: 'FAIL', rawArtifact: raw, classification: 'SOURCE_ARGUMENT_ADMISSION_FAILURE', reasonIdentityPreservedByRethrow: true }); } catch {}
    throw error;
  }
  await api.phase('capture');
  const artifact = await api.writeJson('source-audit.json', { ...report, rawArtifact: raw, fixedGateProofs: 'SCOPED_SOURCE_ARGUMENTS_ONLY_NOT_RUNTIME', privateCounterRuntimeProof: false });
  await api.phase('cleanup');
  readSelectedSources(api.bindings.sourceRoot, manifest);
  await api.guard();
  await api.phase('complete');
  return { status: report.missingArguments ? 'INCOMPLETE' : 'PASS', proofRole: 'source-static-counterproof', details: { boundArguments: report.boundArguments, boundSourceBindings: report.boundSourceBindings, missingArguments: report.missingArguments, semanticPasses: 0, runtimeProofs: 0, independentAcceptance: false }, artifacts: [raw, artifact] };
}
