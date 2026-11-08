import { normalize, caseJobs } from '../preparation-v2/cases.mjs';
import { flagVariants, guards } from '../preparation-v2/scenarios.mjs';
import { smallTarget } from '../preparation-v2/resources.mjs';
export function manifest(documents) {
  const rows = normalize(documents); const limits = documents['final-freeze-v3/LIMITS.json'].rows;
  const jobs = caseJobs(rows, documents['final-freeze-v3/CONTROLS.json']).map(control => ({ ...control, kind: 'case' }));
  for (const row of flagVariants(rows)) jobs.push({ id: row.id, kind: 'case', row: row.id, schedule: 'P0' });
  for (const row of rows.filter(row => row.group === 'selector36' && row.class !== 'VALID')) {
    for (const delivery of ['one', 'split', 'read-ahead']) jobs.push({ id: `${row.id}/file-${delivery}`, kind: 'phase', row: row.id, delivery });
  }
  jobs.push({ id: 'factory', kind: 'factory' }, { id: 'loader-denials', kind: 'loader' });
  for (const [guardIndex, guard] of guards(limits).entries()) jobs.push({ id: guard.id, kind: 'guard', guardIndex });
  for (const route of ['pipe', 'files', 'alias-h']) jobs.push({ id: `F01-${route}`, kind: 'workflow', route });
  for (const aliasKind of ['new', 'distinct-complete', 'same-path', 'hardlink', 'followed-symlink', 'dangling-symlink', 'unknown', 'borrowed-existing', 'invalid-comparison', 'permission', 'raced-wx', 'unsupported-wx', 'readonly', 'partial-space', 'fallback', 'missing-input', 'missing-readStream']) {
    for (const wrapper of ['direct', 'faithful', 'copy-up']) jobs.push({ id: `F10-${aliasKind}-${wrapper}`, kind: 'alias', aliasKind, wrapper });
  }
  for (const relation of ['same', 'distinct', 'unknown', 'invalid', 'conflict']) jobs.push({ id: `F10-authority-${relation}`, kind: 'authority', relation });
  for (const origin of [true, false]) jobs.push({ id: `F04-origin-${origin}`, kind: 'origin', origin });
  for (const delivery of ['poison-next', 'delivered-invalid-tail']) jobs.push({ id: `F04-${delivery}`, kind: 'header', delivery });
  for (const stop of ['header', 'satisfied-range', 'tail-EOF']) for (const ownership of ['borrowed', 'cooperative-owned', 'direct-finally-only']) jobs.push({ id: `F07-${ownership}-${stop}`, kind: 'ownership', ownership, stop });
  for (const reasonKind of ['primitive', 'errno-object']) for (const trigger of ['preabort', 'opaque-late-rejection']) jobs.push({ id: `F08-${trigger}-${reasonKind}`, kind: 'cancellation', trigger, reasonKind });
  for (const trigger of ['read', 'write', 'late-acquisition', 'overlap-dispose', 'failing-cleanup', 'equal-local-reason', 'escaping-over-local', 'cleanup-only', 'mapped-status-not-escaping']) jobs.push({ id: `F08-shell-${trigger}`, kind: 'shell-lifecycle', trigger });
  jobs.push({ id: 'F09-destination-isolation', kind: 'destination' }, { id: 'F09-backpressure', kind: 'backpressure' }, { id: 'F09-fallback-before-publication', kind: 'fallback-limit' });
  jobs.push({ id: 'F01-shared-parent-commands', kind: 'parent', limitKind: 'commands' }, { id: 'F11-parent-output', kind: 'parent', limitKind: 'output' }, { id: 'F01-literal-invoke-env', kind: 'invoke-env' });
  jobs.push({ id: 'F11-depth2-limit1', kind: 'resource', name: 'maxSelectorDepth', limit: 1, target: 2, scale: 'LOWERED' });
  for (const row of limits) {
    if (['maxWork', 'maxRetainedBytes'].includes(row.name)) {
      for (const delta of [-1, 0, 1]) jobs.push({ id: `F11-ledger-${row.name}-${delta}`, kind: 'ledger', name: row.name, delta });
      for (const delta of [-1, 0, 1]) jobs.push({ id: `F11-default-${row.name}-${delta}`, kind: 'unmet', name: row.name, target: row.defaultValue + delta, reason: 'simple source-audited count path does not achieve default work/capacity target; full source event/lifetime ledger uncompleted, no invented hooks' });
    } else {
      for (const delta of [-1, 0, 1]) jobs.push({ id: `F11-small-${row.name}-${delta}`, kind: 'resource', name: row.name, limit: smallTarget(row.name), target: smallTarget(row.name) + delta, scale: 'LOWERED' });
      for (const delta of [-1, 0, 1]) jobs.push({ id: `F11-default-${row.name}-${delta}`, kind: 'resource', name: row.name, limit: row.defaultValue, target: row.defaultValue + delta, scale: 'DEFAULT' });
    }
  }
  return { jobs, rows: [...rows, ...flagVariants(rows)], limits };
}
