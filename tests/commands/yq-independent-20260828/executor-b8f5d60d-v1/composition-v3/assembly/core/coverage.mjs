import { requireFact } from './primitives.mjs';

export function summarizeCoverage(ledger, jobs, outcomes) {
  requireFact(ledger.rows.length === 194 && jobs.length === 336, 'COVERAGE_DOMAIN');
  const observed = new Map(outcomes.map(row => [row.jobId, row]));
  requireFact(observed.size === outcomes.length, 'COVERAGE_DUPLICATES');
  const rows = ledger.rows.map(record => {
    const assigned = jobs.filter(job => job.recordIds.includes(record.id));
    const proofs = assigned.map(job => ({ jobId: job.id, environment: job.environment ?? (job.id === 'TYPE-DIRECT-SIX' ? 'installed-moved-direct' : null), role: job.role, status: observed.get(job.id)?.status ?? 'UNRUN', processClean: observed.has(job.id) && !observed.get(job.id).aggregateFailure, unsafe: observed.get(job.id)?.unsafe ?? false }));
    return { ...record, successorJobs: assigned.map(job => job.id), state: proofs.length === 0 || proofs.some(proof => proof.status === 'UNRUN') ? 'UNRUN_OBLIGATIONS' : record.missingBindings.length > 0 || proofs.some(proof => proof.status === 'INCOMPLETE') ? 'INCOMPLETE_PREPARED_PROJECTION' : proofs.every(proof => proof.status === 'PASS' && proof.processClean) ? 'PREPARED_ROLE_PROJECTIONS_MATCHED' : 'OBSERVED_ROLE_FAILURE_REQUIRES_REVIEW', proofs, fullRecordPass: false, missingBindingState: record.missingBindings.length ? 'UNRUN_NOT_PRODUCT_FAIL' : 'NO_FROZEN_MISSING_BINDING' };
  });
  return { schema: 1, originalIds: 194, overlays: ledger.overlays, roleCounts: ledger.roleCounts, eligibility: ledger.eligibility, missingBindingCounts: ledger.missingBindingCounts, overlap: ledger.overlap, uniqueRuntimeIds: 132, runtimeJobsPerEnvironment: 149, environments: ['source-built-direct', 'installed-moved-direct'], fullRecordAcceptance: false, semanticPassRate: null, sourceTypeDataPackageControlJobsExcludedFromSemanticDenominator: true, rows };
}
