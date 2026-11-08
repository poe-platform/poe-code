import { assessWorkflow as original } from '../executor-preparation-v1/predicates.mjs';

export function assessWorkflow(specimen, report) {
  if (specimen.id !== 'W03') return original(specimen, report);
  const semanticSpecimen = { ...specimen, additionalObservations: [] };
  const semantics = original(semanticSpecimen, report);
  const telemetry = report.telemetry ?? { missing: { status: 'UNQUALIFIED', reason: 'No telemetry receipt supplied.' } };
  const failedObservations = Object.entries(telemetry).filter(([, value]) => value.status === 'FAILED').map(([name]) => name);
  const unqualifiedObservations = Object.entries(telemetry).filter(([, value]) => value.status === 'UNQUALIFIED').map(([name]) => name);
  return {
    ...semantics,
    pass: !semantics.pass || failedObservations.length ? false : unqualifiedObservations.length ? null : true,
    sharedSemanticsPass: semantics.pass,
    status: !semantics.pass || failedObservations.length ? 'FAILED' : unqualifiedObservations.length ? 'SHARED_SEMANTICS_QUALIFIED_TELEMETRY_UNQUALIFIED' : 'QUALIFIED',
    telemetry,
    failedObservations,
    unqualifiedObservations,
    completeTelemetryQualified: failedObservations.length === 0 && unqualifiedObservations.length === 0,
    qualification: 'Shared byte/status/filesystem observations and per-engine telemetry are separate. UNQUALIFIED is never an observed pass.',
  };
}
