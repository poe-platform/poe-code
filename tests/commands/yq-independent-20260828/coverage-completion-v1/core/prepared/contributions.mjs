import { ownRecord, projectData, requireFact, safePath } from './own-data.mjs';

export function validateContribution(value, allocation) {
  ownRecord(value, ['schema', 'abi', 'owner', 'module', 'exports', 'bindingIds', 'fragmentIds', 'recordIds', 'dependencies', 'costs', 'status'], 'CONTRIBUTION');
  const contribution = projectData(value);
  requireFact(contribution.schema === 1 && contribution.abi === 'yq-coverage-additive-v1' && ['core', 'actors', 'assertions'].includes(contribution.owner), 'CONTRIBUTION_ROLE');
  requireFact(contribution.status === 'SEALED_IMPLEMENTATION_UNRUN_TARGET', 'CONTRIBUTION_STATUS');
  const module = ownRecord(contribution.module, ['path', 'sha256', 'bytes', 'mode'], 'CONTRIBUTION_MODULE');
  safePath(module.path);
  requireFact(/^[a-f0-9]{64}$/u.test(module.sha256) && Number.isSafeInteger(module.bytes) && module.bytes > 0 && module.mode === 420, 'CONTRIBUTION_MODULE_IDENTITY');
  const costs = ownRecord(contribution.costs, ['outerSlots', 'nestedTools', 'wallMs', 'stdoutBytes', 'stderrBytes', 'metadataBytes', 'storageBytes', 'events'], 'CONTRIBUTION_COSTS');
  requireFact(Object.values(costs).every(amount => Number.isSafeInteger(amount) && amount >= 0), 'CONTRIBUTION_COST_INTEGER');
  for (const [name, inventory] of [['bindingIds', allocation.gaps], ['fragmentIds', allocation.fragments], ['recordIds', allocation.records]]) {
    const ids = contribution[name];
    requireFact(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && inventory.some(row => row.id === id)), 'CONTRIBUTION_IDS');
    if (name !== 'recordIds') requireFact(ids.every(id => inventory.find(row => row.id === id).primaryOwner === contribution.owner || (name === 'bindingIds' && allocation.criticalRepairs.some(row => row.applicableObservationOwner === contribution.owner && row.missingIds.includes(id)))), 'CONTRIBUTION_OWNERSHIP');
  }
  requireFact(Array.isArray(contribution.exports) && contribution.exports.length > 0 && contribution.exports.every(name => typeof name === 'string') && Array.isArray(contribution.dependencies), 'CONTRIBUTION_EXPORTS');
  return contribution;
}

export function validateObservations(value, bindingIds) {
  const rows = projectData(value);
  requireFact(Array.isArray(rows) && rows.length <= 512, 'OBSERVATIONS_BOUND');
  const seen = new Set();
  for (const row of rows) {
    ownRecord(row, ['bindingId', 'recordId', 'role', 'status', 'facts', 'evidenceRefs'], 'OBSERVATION');
    requireFact(typeof row.bindingId === 'string' && bindingIds.includes(row.bindingId) && !seen.has(row.bindingId), 'OBSERVATION_ENROLLMENT');
    requireFact(typeof row.recordId === 'string' && row.role === 'runtime' && ['OBSERVED', 'UNOBSERVED'].includes(row.status), 'OBSERVATION_ROLE');
    requireFact(Array.isArray(row.evidenceRefs), 'OBSERVATION_EVIDENCE');
    seen.add(row.bindingId);
  }
  return rows;
}
