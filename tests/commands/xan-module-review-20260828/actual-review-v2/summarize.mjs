import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, json, identity, durable } from './common.mjs';
const directory = path.join(ROOT, 'evidence-continuation');
const result = await json(path.join(directory, 'RESULT.json')); const outcomes = await json(path.join(directory, 'OUTCOMES.json'));
const seal = await json(path.join(ROOT, 'PRE-SEAL.json')); const coverage = await json(path.join(directory, 'COVERAGE.json'));
const groups = {}; const loads = {}; const failures = []; const selected = []; const rawFiles = new Map();
for (const record of outcomes) {
  const key = `${record.layout}/${record.kind}`; groups[key] ??= { pass: 0, fail: 0, blocked: 0 }; groups[key][record.status.toLowerCase()]++;
  if (record.status === 'FAIL') failures.push({ layout: record.layout, id: record.id, kind: record.kind, raw: record.raw,
    interpretation: record.kind === 'phase' || ['workflow', 'origin'].includes(record.kind) ? 'REVIEWER_DRIVER_DEFECT_NOT_PRODUCT_FAILURE'
      : record.kind === 'shell-lifecycle' ? 'PROVENANCE_PROBE_CONFOUNDED_NO_CANDIDATE_BUG_ESTABLISHED'
      : record.kind === 'ledger' ? 'ACTUAL_EMPTY_LIMIT_DIAGNOSTIC_FROZEN_PREDICATE_DISCREPANCY'
      : 'SEALED_SEMANTIC_MATCHER_FAILURE_NO_AUTOMATIC_PRODUCT_BUG', error: record.failure });
  if (!rawFiles.has(record.raw)) rawFiles.set(record.raw, (await readFile(path.join(directory, record.raw), 'utf8')).trim().split('\n').map(JSON.parse));
}
for (const [filename, records] of rawFiles) {
  const loaded = records.find(record => record.stage === 'ACTUAL_LOADS'); assert.ok(loaded);
  loads[loaded.layout] ??= new Map();
  for (const entry of loaded.loads) loads[loaded.layout].set(entry.url, entry);
  for (const id of ['F11-ledger-maxWork--1', 'F11-ledger-maxRetainedBytes--1', 'X4-S01/P0', 'X4-R04/P0', 'B01-R1-repeat/P0', 'X4-R01/file-split', 'F01-files', 'F08-shell-escaping-over-local', 'F11-default-maxInputBytes-0', 'F11-default-maxOutputBytes-0']) {
    const observation = records.find(record => record.stage === 'RAW_OBSERVATION' && record.id === id); if (!observation) continue;
    const control = seal.cohort.jobs.find(job => job.id === id); const row = seal.cohort.rows.find(row => row.id === control.row);
    selected.push({ layout: loaded.layout, id, source: { path: `evidence-continuation/${filename}`, ...await identity(path.join(directory, filename)) }, control,
      ...(row ? { frozenRow: row } : {}), ...(control.kind === 'ledger' ? { literalInvocation: { argv: ['count'], stdinHex: '610a', options: { limits: { [control.name]: (control.name === 'maxWork' ? 15 : 64) + control.delta } } } } : {}),
      observation, outcome: records.find(record => record.stage === 'CASE' && record.id === id) });
  }
}
const primary = {};
for (const layout of ['SOURCE', 'INSTALLED_MOVED']) {
  primary[layout] = {};
  for (const group of ['prior88', 'selector36', 'ratification14']) {
    const rows = seal.cohort.rows.filter(row => row.group === group && !row.originalId);
    const selected = rows.map(row => ({ id: row.id, status: outcomes.find(record => record.layout === layout && record.id === row.id + '/P0')?.status ?? 'UNRUN' }));
    primary[layout][group] = { count: rows.length, statuses: selected, pass: selected.filter(row => row.status === 'PASS').length, fail: selected.filter(row => row.status === 'FAIL').length, unrun: selected.filter(row => row.status === 'UNRUN').length };
  }
}
const familyLimits = {
  F01: 'Workflow middleware discarded CommandResult; stage bytes were observed, but workflow pass/registry/budget claims remain unqualified. Parent command/output probes recorded real Shell limits, not shared-budget object identity.',
  F02: 'Declared chunk schedules and cut points executed; no universal schedule or native parity claim.',
  F03: 'Prepared borrowed reuse schedules and simple owned early-return controls executed; complete per-fixture owned-resource/finalizer matrix not run.',
  F04: 'Origin booleans observed but origin invocation status confounded by middleware return defect; raw header poison/read-ahead controls executed.',
  F05: 'Valid concrete selector vectors executed. Diagnostic matcher disagreements and file-phase driver defect prevent whole selector-family acceptance.',
  F06: 'All frozen zero/tail byte cases executed; full zero-tail alias/error cross-product not run.',
  F07: 'Three ownership forms and three stop points executed, but no complete acquisition-admission/late-owned-handle matrix.',
  F08: 'Registered root cleanup gates, failure/drain, caller cancellation and opaque-late rejection executed. Two local-provenance probes are confounded; full prepared trigger/reason cross-product not run.',
  F09: 'Destination isolation, awaited backpressure, acknowledged partial stream and prepublication fallback limit executed. Explicit child scopes/wrapper-not-owned and full fallback capacity ledgers not completed.',
  F10: '51 direct/faithful/coherent-rebound alias/error probes executed plus four comparison answers. Two-authority conflict and mixed read/write lazy copy-up composition are unfinished drivers, NOT a proven API impossibility.',
  F11: 'All 18 caps have actual configuration/boundary observations. Default work/capacity ledgers unimplemented; default input/output attempts can be incomplete; generator reachability labels are recipe limitations only. Some resource passes assert boundary status/diagnostic with digest capture, not full semantic-output golden equivalence.',
  F12: 'Frozen independent logical-vector reparsing ran alongside byte cases. No all-dialect or native equivalence claim.',
};
const obligations = coverage.obligations.map(obligation => {
  let interpretation;
  if (obligation.kind === 'family') interpretation = familyLimits[obligation.id];
  else if (obligation.kind === 'cap') interpretation = 'Inspect each actual target/configuration receipt; runtime status/digest probes are not complete work/capacity/default semantic certification.';
  else if (obligation.kind === 'selector' && obligation.id.startsWith('X4-P')) interpretation = 'Frozen valid P0 row executed in both layouts; not a universal grammar certificate.';
  else if (obligation.kind === 'selector') interpretation = 'P0 actually executed; file-phase variants all failed due reviewer argv construction. No file-phase coverage credit.';
  else if (obligation.kind === 'ratification') interpretation = 'Targeted normalized rows actually executed; failures retain sealed matcher results without imposing new diagnostic spellings.';
  else interpretation = 'Frozen prior reference actually executed with byte/project-semantic assertions; not a native replay or full-package claim.';
  return { ...obligation, interpretation };
});
assert.equal(obligations.length, 161); assert.ok(obligations.every(obligation => obligation.actualIds.length));
const unrun = outcomes.filter(record => record.status === 'BLOCKED').map(record => ({ layout: record.layout, id: record.id, reason: record.reason,
  attempted: record.reason?.startsWith('ACTUAL_RESOURCE_ATTEMPT') ?? false, raw: record.raw }));
await durable(path.join(ROOT, 'MINIMAL-REPROS.json'), { classification: 'COPIED_ACTUAL_RAW_WITH_BINDINGS_NOT_A_REPLAY', cases: selected });
await durable(path.join(ROOT, 'OBLIGATION-REVIEW.json'), { mapped: 161, unmapped: 0, obligations, familyLimits, unrun });
await durable(path.join(ROOT, 'REVIEW-RESULT.json'), { classification: 'ACTUAL_COHORT_FINISHED_NONZERO_NOT_FULL_REVIEW_ACCEPTANCE', result, primary, groups, failures, unrun,
  actualLoadedModules: Object.fromEntries(Object.entries(loads).map(([layout, entries]) => [layout, [...entries.values()]])),
  originalRecipe: '549f2055eb964c33cdbf26109645a422b2b5194a', continuationRecipe: result.recipeCommit,
  originalSeal: await identity(path.join(ROOT, 'PRE-SEAL.json')), continuationSeal: await identity(path.join(ROOT, 'CONTINUATION-PRE.json')),
  priorFailedCompiler: await json(path.join(ROOT, 'evidence/RESULT.json')), syntheticChildren: 4,
  compilationAttempts: 2, runtimeCohorts: 1, candidateCaseRetries: 0, nativeRuns: 0,
  reviewIncomplete: 'Unfinished file-phase/middleware/local-provenance bridges, full source ledgers and stated family subcontrols are reviewer gaps; no full acceptance, new policy or superiority claim.' });
console.log(JSON.stringify({ perLayout: result.perLayout, groups, mappedObligations: obligations.length, actualLoadedModules: Object.fromEntries(Object.entries(loads).map(([layout, entries]) => [layout, entries.size])) }));
