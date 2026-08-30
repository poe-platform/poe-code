import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addEvidence, owned, frozenJson, originalCommit, originalBase, extensionCommit, extensionBase, verifyFrozen } from './review.mjs';

if (process.argv[2] !== 'capture') { verifyFrozen(); console.log('Read-only verification; explicit capture required.'); process.exit(0); }
const captures = ['controls-27a77935/controls.json', 'supplement-27a77935/controls.json', 'remaining-first/controls.json', 'independent-first/controls.json'];
const observations = captures.flatMap(capture => JSON.parse(readFileSync(`${owned}/${capture}`)).rows.map(row => ({ capture, ...row })));
assert(observations.every(row => row.passed));
function refs(...prefixes) {
  const rows = observations.filter(row => prefixes.some(prefix => row.id.startsWith(prefix)));
  assert(rows.length, prefixes.join(','));
  return rows.map(({ capture, id, passed }) => ({ capture, id, passed }));
}
const originalMap = {
  'direct-zero-stdin-reads': ['direct-zero-stdin-'],
  'await-stdout-backpressure': ['backpressure-'],
  'sink-rejection': ['sink-rejection'],
  'preabort-and-midflight': ['direct-abort-', 'lifecycle-abort-', 'shell-lifecycle-', 'typed-synthetic-', 'native-expr-', 'native-legacy-', 'index-large-cancellation'],
  'cleanup-ownership': ['registration-', 'lifecycle-termination-latch', 'lifecycle-late-', 'shell-lifecycle-', 'direct-finally-no-hook'],
  'arg-byte-boundary': ['argument-bytes-'],
  'digit-boundary': ['numeric-'],
  'node-boundary': ['nodes-', 'chain-'],
  'depth-boundary': ['depth-'],
  'work-boundary': ['work-', 'shared-work-remaining', 'index-', 'shell-shared-command-budget'],
  'output-boundary': ['output-', 'numeric-128-', 'shell-output-', 'real-vfs-'],
  'required-regex-worker': ['evaluated-regex-', 'empty-subject-invalid-', 'redos-original-', 'wire-', 'native-expr-active-'],
  'bounded-redos': ['redos-original-'],
  'short-circuit-worker-admission': ['shortcircuit-', 'shell-shortcircuit-', 'evaluated-regex-'],
  'unicode-contract': ['unicode-', 'wire-', 'real-vfs-invalid-'],
  'no-host-effects': ['direct-zero-stdin-', 'real-vfs-', 'redos-original-'],
};
const ranges = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => `protocol-M${String(start + index).padStart(2, '0')}`);
const extensionMap = {
  'P01-envelope-dispatch': [...ranges(1, 8), 'M08-'],
  'P02-result-shape': [...ranges(9, 16), 'protocol-extra-', 'protocol-negative-', 'protocol-fractional-', 'protocol-nan-', 'variant-'],
  'P03-span-validation': [...ranges(17, 26), 'variant-', 'wire-'],
  'P04-state-consistency': [...ranges(27, 32), 'wire-state-'],
  'P05-byte-span-roundtrip': ['wire-whole-', 'wire-shifted-', 'real-vfs-invalid-'],
  'P06-owned-request-bytes': ['lifecycle-owned-bytes'],
  'P07-cache-and-response-isolation': ['cache-and-response-isolation'],
  'P08-worker-request-rejection': ['malformed-request-'],
  'L01-zero-admission': ['shortcircuit-', 'shell-shortcircuit-', 'evaluated-regex-'],
  'L02-registration-order': ['registration-close', 'shell-lifecycle-'],
  'L03-registration-throw': ['registration-throw-'],
  'L04-late-acquisition-rejection': ['lifecycle-late-startup-error'],
  'L05-admission-budgets': ['lifecycle-queue', 'lifecycle-owned-bytes'],
  'L06-startup-timeout': ['lifecycle-startup-timeout', 'replacement-startup-timeout'],
  'L07-active-timeout': ['lifecycle-active-timeout', 'lifecycle-malformed', 'replacement-active-timeout', 'replacement-malformed'],
  'L08-exact-abort-reasons': ['lifecycle-undefined-rejection', 'synthetic-undefined-abort', 'typed-synthetic-', 'native-expr-', 'native-legacy-', 'lifecycle-abort-'],
  'L09-termination-latch': ['lifecycle-termination-latch', 'shell-lifecycle-'],
  'L10-callerabort-and-natural-close': ['shell-lifecycle-', 'direct-finally-no-hook', 'native-expr-active-', 'native-legacy-active-'],
  'L11-work-and-error-categories': ['worker-cap-', 'shared-work-', 'empty-subject-invalid-', 'protocol-negative-', 'protocol-fractional-', 'protocol-nan-', 'index-'],
  'L12-worker-only-compile': ['evaluated-regex-', 'redos-original-', 'native-expr-active-'],
  'R01-legacy-protocol-unchanged': ['legacy-protocol-'],
  'R02-installed-standalone': ['native-expr-', 'evaluated-regex-positive'],
  'R03-original-separate-denominators': [],
  'R04-installed-legacy-transcript': ['legacy-transcript-'],
};
const limits = {
  'preabort-and-midflight': ['PHASE_NOT_OBSERVED', 'Actual worker startup/active exchange and retirement, native and synthetic identities, output and index cancellation pass. Precise compiler-versus-matcher interruption is not instrumented or observed.'],
  'work-boundary': ['EXECUTED_BOUNDED', 'Dedicated 2048-by-64 ASCII index: 399505 refuses, 399506/399507 return exact no-match; positive last match returns2048; external cancellation at eighth immediate turn rejects exact Error without output/workers. Same frozen work-boundary requirement, not new breadth.'],
  'bounded-redos': ['CONTAINMENT_ONLY', 'Four original inputs: product remains bounded and outer watchdog never times out; unsupported nullable pattern is not semantic success.'],
  'unicode-contract': ['PROFILE_LIMIT', 'C.UTF-8 scalar and C byte controls pass; named en_US.UTF-8 frozen mismatches persist. Arbitrary invalid-byte argv unmeasured.'],
  'no-host-effects': ['BOUNDED_AUDIT', 'Installed import graph and direct traps plus actual VFS; no general host-JavaScript sandbox claim.'],
  'P05-byte-span-roundtrip': ['PROFILE_LIMIT', 'Byte/scalar wire spans and invalid-UTF8 VFS output pass; named en_US.UTF-8 CLI remains unsupported.'],
  'P06-owned-request-bytes': ['EXECUTED_BOUNDED', 'Retained queued Buffer mutation isolation, not arbitrary concurrent mutation or leases.'],
  'P08-worker-request-rejection': ['EXECUTED_WITH_RETIREMENT', 'Eight malformed requests bounded by reply or isolated worker error/exit; each has fresh actual worker positive. Not all malformed inputs are graceful typed errors.'],
  'L04-late-acquisition-rejection': ['EXECUTED_WITH_NA', 'RegexExecutor.open is synchronous; async acquisition is not applicable. Late admitted startup rejection under held retirement is observed without unhandled rejection.'],
  'L06-startup-timeout': ['EXECUTED_CORRECTED_PROFILE', 'Target startup80ms unchanged; separately corrected held sibling request500ms. Original all80ms supplement failures remain historical.'],
  'L07-active-timeout': ['EXECUTED_CORRECTED_PROFILE', 'Target active80ms unchanged; separately corrected sibling startup500ms with ready release. No unchanged all80ms claim.'],
  'L08-exact-abort-reasons': ['EXECUTED_BOUNDED', 'Both old undefined failures now reject exact undefined. Independent strict EventTarget structural signal is direct-request only; native session run/matchExpr use native AbortSignal.any and preserve actual native AbortError,0,null,false,empty,Error. Author111 is separate overlapping regression replay.'],
  'L10-callerabort-and-natural-close': ['PHASE_NOT_OBSERVED', 'Real forwarded worker request cancellation/retirement and fresh replacement pass; Shell real-worker termination latch/sibling and finally pass. Exact compiler-versus-matcher phase unknown.'],
  'R01-legacy-protocol-unchanged': ['EXECUTED_BOUNDED', 'Installed baseline/fixed grep,rg,glob defaults/response equality;276 unchanged archived regression cases pass. Separate opt-in native aliases remain skipped when not configured.'],
  'R02-installed-standalone': ['EXECUTED_STANDALONE_ONLY', 'distribution-27a77935/* plus independent-first/typecheck.json: offline archive/build/pack/install/move, strict skipLibCheck=false consumer and plainNode. No expr root/subpath/default export claim.'],
  'R03-original-separate-denominators': ['SEMANTIC_ACCEPTANCE_FAIL', 'Authoritative evidence acceptance-27a77935/* and native-27a77935/native-replay.json: original104 GNU97semantic/89strict; extension23 GNU20semantic/19strict; correction1/1. Apple remains separate.'],
};
function records(specifications, map) {
  assert.deepEqual(Object.keys(map).sort(), specifications.map(spec => spec.id).sort());
  return specifications.map(specification => {
    const [status, scope] = limits[specification.id] ?? ['EXECUTED_BOUNDED', 'Concrete listed subcases passed; not universal semantics or a combined feature score.'];
    return { id: specification.id, frozenRequirement: specification, status, scope, observations: map[specification.id].length ? refs(...map[specification.id]) : [], ...(specification.id === 'R03-original-separate-denominators' ? { artifacts: ['acceptance-27a77935/summary.json', 'native-27a77935/native-replay.json', 'frozen-comparators/original95-comparison.json', 'frozen-comparators/extension-original20-comparison.json'] } : {}) };
  });
}
const original = frozenJson(originalCommit, `${originalBase}/controls.json`);
const extension = frozenJson(extensionCommit, `${extensionBase}/controls.json`);
const mutations = frozenJson(extensionCommit, `${extensionBase}/mutations.json`).mutations;
addEvidence(`${owned}/coverage.json`, {
  candidate: '27a7793526830768484885afba5832bf8bb248b5', classification: 'Undefined cancellation defects closed; frozen semantic/diagnostic acceptance remains FAIL. No full expr completion.',
  original: records(original.controls, originalMap), extension: records(extension.controls, extensionMap),
  shellWorkflows: original.shellWorkflows.map(spec => ({ id: spec.id, frozenRequirement: spec, observations: refs(`shell-${spec.id}`) })),
  mutations: mutations.map(spec => ({ id: spec.id, frozenRequirement: spec, observations: refs(`protocol-${spec.id}`) })),
  cohorts: captures.map(capture => ({ capture, rows: observations.filter(row => row.capture === capture).length, failed: observations.filter(row => row.capture === capture && !row.passed).length })),
  archivedRegressionCounts: { legacy: { passed: 276, skipped: 0 }, invocationCleanup: { passed: 30, skipped: 0 }, authorAbort: { passed: 111, skipped: 0, independentHoldouts: false }, optionalNativeAliases: { passed: 50, skipped: 2 } },
  counting: '32 frozen protocol specs include30 malformed and2 valid-state controls, each with paired positives in driver; not32 malformed cases. 7 workflows and4 ReDoS embedded in146 core rows. All row cohorts overlap semantics; do not add into a specification denominator. Author111 overlaps native/synthetic and lifecycle coverage, not independent acceptance.',
});
console.log(JSON.stringify({ original: original.controls.length, extension: extension.controls.length, mutations: mutations.length, workflows: original.shellWorkflows.length }));
