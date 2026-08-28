export async function runWorker(api) {
  await api.phase('admission', { environment: api.job.environment });
  const materialization = await api.materializePackage({ environment: api.job.environment });
  const raw = await api.captureSemantic({ materialization, runtimeJobId: api.job.obligationGroup });
  const projection = await api.assertProjection({ receipt: raw.receipt, runtimeJobId: api.job.obligationGroup });
  await api.phase('cleanup', { commandCleanupCaptured: true });
  await api.guard();
  await api.phase('complete');
  return { status: projection.status === 'BOUND_PROJECTION_ONLY' ? 'PASS' : projection.status, proofRole: api.job.role, details: { projection, semanticFullRecordPass: false, runtimeJobId: api.job.obligationGroup, rawCapturePath: raw.capturePath } };
}
