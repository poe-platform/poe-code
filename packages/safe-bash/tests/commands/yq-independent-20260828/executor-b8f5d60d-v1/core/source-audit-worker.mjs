import { join } from 'node:path';
import { fileDigest, requireFact } from './primitives.mjs';

export async function runWorker(api) {
  await api.phase('admission', { sourceOnly: true, productImport: false });
  await api.guard();
  await api.phase('operation', { operation: 'designated-source-data-audit' });
  const source = await api.readBoundJson('sourceManifest');
  const proofs = await api.readBoundJson('sourceProofPlan');
  const boundaries = await api.readBoundJson('boundaryProofs');
  const identities = [];
  for (const [name, expected] of Object.entries(source.files)) {
    const actual = fileDigest(join(api.bindings.sourceRoot, name));
    requireFact(actual.sha256 === expected.sha256 && actual.mode === expected.mode && actual.bytes === expected.bytes, 'SOURCE_AUDIT_BYTES');
    identities.push({ path: name, ...actual });
  }
  const records = proofs.designated.map(record => ({ id: record.id, status: 'UNRUN_SOURCE_ARGUMENT', runtimePrivateCounterProof: false, fullRecordPass: false, required: record.required, predicate: record.sourcePredicateBinding }));
  await api.phase('capture');
  const artifact = await api.writeJson('source-audit.json', { identities, records, repairIds: proofs.repairIds, postCandidateBoundaryQualifications: boundaries, productImports: 0, fixedGateProofs: 'UNRUN_PENDING_DIFFERENT_SOURCE_ARGUMENT', sourceIdentityIsNotSemanticProof: true });
  await api.phase('cleanup');
  await api.guard();
  await api.phase('complete');
  return { status: 'INCOMPLETE', proofRole: 'source-static-counterproof', details: { designatedRecords: records.length, repairProofs: 'UNRUN', privateCounterRuntimeProof: false }, artifacts: [artifact] };
}
