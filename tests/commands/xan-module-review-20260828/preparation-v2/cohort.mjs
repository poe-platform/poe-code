import { caseJobs } from './cases.mjs';
import { scenarios, guards, flagVariants } from './scenarios.mjs';

export const admissionMutants = ['missing-artifact', 'altered-artifact', 'stale-build', 'truthy-receipt', 'bad-exit', 'truncated', 'missing-tool', 'wrong-pack-tree', 'non-xan-delta', 'registry', 'export', 'wrong-mode', 'symlink', 'unknown-path', 'overflow-bytes', 'loader-fallback', 'outside-write', 'missing-api', 'wrong-layout'];
export const deliveryControls = ['one', 'split', 'read-ahead', 'one-extra-next', 'split-short', 'read-ahead-undercharge'];
export const mockControls = ['success', 'race', 'unsupported', 'partial', 'fallback', 'cancel'];
export const processControls = ['ordinary-success', 'ordinary-failure', 'missing-required-phase', 'raw-overflow', 'intentional-timeout', 'large-stream', 'SOURCE', 'INSTALLED_MOVED'];

export function planCohort(rows, documents) {
  const result = [];
  const add = (id, kind, details) => result.push({ id, kind, ...details });
  for (const job of caseJobs(rows, documents['final-freeze-v3/CONTROLS.json'])) add(`case:${job.id}`, 'case', { job });
  for (const row of rows) add(`mutant-case:${row.id}`, 'case-mutant', { row: row.id });
  for (const row of rows.filter(item => item.expected.stderr.precision)) for (const variant of ['positive', 'wrong-command', 'wrong-option-context', 'wrong-condition', 'missing-fragment', 'unrelated-error']) add(`diagnostic:${row.id}:${variant}`, 'diagnostic', { row: row.id, variant });
  for (const scenario of scenarios()) {
    add(`scenario:${scenario.id}`, 'scenario', { scenario: scenario.id });
    for (const key of Object.keys(scenario.expected)) add(`scenario-mutant:${scenario.id}:${key}`, 'scenario-mutant', { scenario: scenario.id, key });
  }
  for (const row of documents['final-freeze-v3/LIMITS.json'].rows) {
    for (const variant of ['positive', 'faulty-ledger', 'boundary-minus', 'boundary-equal', 'boundary-plus', 'ceiling-minus', 'ceiling-equal', 'ceiling-plus']) add(`resource:${row.name}:${variant}`, 'resource', { name: row.name, variant });
  }
  for (const variant of ['cell-quoted', 'cell-doubled', 'columns-trailing', 'nodes-occurrence', 'nodes-complement', 'work-cumulative', 'retained-overlap', 'retained-units', 'parent-output', 'diagnostic-no-room']) add(`resource-extra:${variant}`, 'resource-extra', { variant });
  for (const variant of ['complete', ...admissionMutants]) add(`admission:${variant}`, 'admission', { variant });
  for (const variant of ['complete', 'outside-write', 'original-writable', 'not-fresh', 'loader-fallback', 'native-spawn', 'eval']) add(`emission:${variant}`, 'emission', { variant });
  for (const variant of deliveryControls) add(`delivery:${variant}`, 'delivery', { variant });
  for (const variant of ['drains', 'premature-settlement', 'reason-object-identity', 'primitive-provenance', 'destination-local', 'opaque-late-observed']) add(`cooperative:${variant}`, 'cooperative', { variant });
  for (const variant of ['transient-backpressure', 'owned-finalizer-overwrite', 'failing-plus-gated', 'destination-sibling-alive']) add(`lifecycle:${variant}`, 'lifecycle', { variant });
  for (const variant of ['same', 'distinct', 'unknown', 'conflict', 'invalid', 'faithful', 'copy-up']) add(`authority:${variant}`, 'authority', { variant });
  for (const kind of mockControls) add(`mock:${kind}`, 'mock', { variant: kind });
  for (const guard of guards(documents['final-freeze-v3/LIMITS.json'].rows)) for (const mutant of [false, true]) add(`${guard.id}:${mutant}`, 'guard', { guard: guard.id, mutant });
  for (const row of flagVariants(rows)) add(row.id, 'flag', { row: row.id });
  for (const kind of processControls) add(`process:${kind}`, 'process', { variant: kind });
  for (const kind of ['continue-ordinary', 'stop-unclosed', 'stop-integrity', 'missing-phase-nonzero', 'failed-phase-nonzero', 'raw-bound-nonzero']) add(`aggregate:${kind}`, 'aggregate', { variant: kind });
  return { classification: 'PREDECLARED_SYNTHETIC_CONTROLS_NOT_PRODUCT_CASE_PASSES', count: result.length, controls: result,
    candidateCases: { prior: 88, selectors: 36, ratificationBindings: 14, executed: 0 },
    childCount: processControls.length, intentionalKillKinds: ['raw-overflow', 'intentional-timeout'],
    rawStreamBytes: 5 * 1024 * 1024 + 17, ordinaryLogBytes: 16384, previewBytes: 1024,
    singleInvocation: true, retryAfterSeal: false };
}
