import path from 'node:path';
import { hash, requireThat } from './safety.mjs';

export function phasePlan(plan, phase) {
  requireThat(['admission', 'cohort'].includes(phase), 'PLAN_PHASE', phase);
  return { limits: plan.limits, command: plan.command, phase, operations: plan[phase] };
}
export function bindGrantPlan(grant, context, plan) {
  const frozen = phasePlan(plan, context.phase);
  requireThat(/^[a-z0-9-]{1,64}$/.test(context.runId ?? ''), 'GRANT_RUN_ID', context.runId);
  const expectedRoot = path.join(context.root, 'runs', context.runId);
  requireThat(grant.phase === context.phase && grant.runId === context.runId && grant.outputRoot === expectedRoot && context.outputRoot === expectedRoot, 'GRANT_RUN_BINDING', context);
  requireThat(grant.planSha256 === hash(JSON.stringify(frozen)), 'GRANT_PLAN_BINDING', grant.planSha256);
  requireThat(JSON.stringify(grant.command) === JSON.stringify({ entry: 'coordinator.mjs', phase: context.phase, runId: context.runId, nodeArgs: plan.command.nodeArgs }), 'GRANT_COMMAND_BINDING', grant.command);
  return frozen;
}
export function authorizeOperation(approved, config, plan, context, worker) {
  bindGrantPlan(approved, context, plan);
  if (worker === 'engine') requireThat(context.phase === 'admission' ? ['probe', 'C11'].includes(config.kind) : config.kind === 'case', 'OPERATION_PHASE', { phase: context.phase, kind: config.kind });
  else requireThat(context.phase === 'admission' && config.kind === 'control', 'OPERATION_PHASE', { phase: context.phase, kind: config.kind });
  const operation = plan[context.phase].find(row => row.id === config.operationId);
  requireThat(operation && operation.ordinal === config.operationOrdinal && operation.worker === worker && operation.kind === config.kind, 'OPERATION_BINDING', config.operationId);
  if (worker === 'control') {
    requireThat(config.family === operation.family && config.mode === operation.mode && (config.entry ?? 'loaded.mjs') === operation.entry && JSON.stringify(config.view?.files) === JSON.stringify(operation.files) && config.view.root === path.join(context.outputRoot, 'synthetic-view'), 'CONTROL_OPERATION_BINDING', operation.id);
    requireThat(!Object.hasOwn(config, 'specimen') && !Object.hasOwn(config, 'negative'), 'CONTROL_ARGUMENTS', operation.id);
  } else {
    requireThat(config.view?.name === operation.layout, 'OPERATION_LAYOUT', config.view?.name);
    if (config.kind === 'case') requireThat(config.specimen?.id === operation.caseId && hash(JSON.stringify(config.specimen)) === operation.specimenSha256 && !Object.hasOwn(config, 'negative'), 'OPERATION_SPECIMEN', operation.id);
    else requireThat(!Object.hasOwn(config, 'specimen') && (config.kind === 'C11' ? config.negative === operation.negative : !Object.hasOwn(config, 'negative')), 'OPERATION_ARGUMENTS', operation.id);
  }
  return operation;
}
export function selectOperation(approved, config, plan, context, worker) {
  const matches = [];
  for (const operation of plan[context.phase]) {
    if (operation.worker !== worker || operation.kind !== config.kind) continue;
    try { authorizeOperation(approved, { ...config, operationId: operation.id, operationOrdinal: operation.ordinal }, plan, context, worker); matches.push(operation); }
    catch (error) { if (!['OPERATION_LAYOUT', 'OPERATION_SPECIMEN', 'OPERATION_ARGUMENTS', 'CONTROL_OPERATION_BINDING', 'CONTROL_ARGUMENTS'].includes(error.code)) throw error; }
  }
  requireThat(matches.length === 1, 'OPERATION_SELECTION', matches.map(operation => operation.id));
  return matches[0];
}
