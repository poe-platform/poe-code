import assert from 'node:assert/strict';
import { root, owned, read, json, binding, archive, hash, freeze, independent, candidate, base, resultCommit } from './pinned.mjs';
import { equivalentRows, heldRows, proposal } from './corrections.mjs';

const review = json(`${root}actual-review-v2/REVIEW-RESULT.json`);
const obligations = json(`${root}actual-review-v2/OBLIGATION-REVIEW.json`);
const selectors = json(`${independent}SELECTOR-FREEZE-V4.json`, freeze);
const rules = json(`${independent}B01-RATIFICATION-7.json`, freeze);
const limits = json(`${independent}final-freeze-v3/LIMITS.json`, freeze);
const evidence = await archive();
const sourceBindings = {};
for (const path of ['FINAL-CONTRACT-V4.md', 'FINAL-BINDING-V4.json', 'SELECTOR-FREEZE-V4.json', 'B01-RATIFICATION-7.json', 'final-freeze-v3/LIMITS.json', 'final-freeze-v3/CONTROLS.json']) sourceBindings[`${freeze}:${independent}${path}`] = binding(`${independent}${path}`, freeze);
for (const name of ['REVIEW-RESULT.json', 'OBLIGATION-REVIEW.json', 'MINIMAL-REPROS.json', 'HANDOFF.md', 'SOURCE-AUDIT.md']) sourceBindings[`${resultCommit}:${root}actual-review-v2/${name}`] = binding(`${root}actual-review-v2/${name}`);
function source(path, first, last = first, revision = resultCommit) {
  const key = `${revision}:${path}`;
  sourceBindings[key] ??= binding(path, revision);
  return { binding: key, first, last, text: read(path, revision).toString().split('\n').slice(first - 1, last).join('\n') };
}
const refs = {
  matcher: source(`${root}preparation-v2/diagnostics.mjs`, 3, 91),
  case: source(`${root}preparation-v2/cases.mjs`, 31, 66),
  phase: source(`${root}actual-review-v2/adapter.mjs`, 63, 78),
  workflow: source(`${root}actual-review-v1/extra.mjs`, 65, 90),
  origin: source(`${root}actual-review-v2/adapter.mjs`, 134, 138),
  provenance: source(`${root}actual-review-v2/lifecycle.mjs`, 15, 73),
  resultContract: source('src/contracts/plugin.ts', 4, 9, base),
  routeContract: source('src/contracts/command.md', 33, 43, base),
  routeImplementation: source('src/shell/runtime.ts', 570, 587, base),
  ledger: source(`${root}actual-review-v2/adapter.mjs`, 172, 178),
  resource: source(`${root}actual-review-v2/adapter.mjs`, 180, 196),
  authority: source(`${root}actual-review-v2/adapter.mjs`, 113, 119),
  unmet: source(`${root}actual-review-v2/manifest.mjs`, 30, 38),
  depth: source(`${root}preparation-v2/resources.mjs`, 138, 141),
  oddOutput: source(`${root}preparation-v2/resources.mjs`, 157, 166),
  flagVariants: source(`${root}preparation-v2/scenarios.mjs`, 134, 141),
  argument: source('src/commands/xan/argv.ts', 78, 115, candidate),
  diagnostic: source('src/commands/xan/index.ts', 36, 76, candidate),
  budget: source('src/commands/xan/budget.ts', 14, 66, candidate),
  inputScope: source('src/commands/xan/io.ts', 78, 96, candidate),
  managed: source('src/commands/xan/io.ts', 139, 169, candidate),
  count: source('src/commands/xan/commands.ts', 12, 27, candidate),
  scanner: source('src/commands/xan/csv.ts', 26, 91, candidate),
  scannerRelease: source('src/commands/xan/csv.ts', 128, 139, candidate),
  writer: source('src/commands/xan/writer.ts', 74, 79, candidate),
  options: source('src/commands/xan/options.ts', 1, 36, candidate),
};

function rowFor(id) {
  const normalized = id.replace(/^flag-\d+-/, '').replace(/\/(?:P0|file-.*)$/, '');
  const selector = selectors.cases.find(row => row.id === normalized);
  if (selector) return { ...selector, stdinHex: Buffer.from(selectors.fixtures[selector.fixture]).toString('hex'), expected: selectors.failureDefaults, normalizedId: normalized };
  for (const rule of rules.rules) {
    const row = rule.cases.find(row => row.id === normalized);
    if (row) return { ...row, rule: rule.id, ruleText: rule.rule, stdinHex: Buffer.from(rules.commonInputUtf8).toString('hex'), expected: row.expected === 'rejection' ? rules.rejection : row.expected, normalizedId: normalized };
  }
}

function classify(item, observation) {
  const row = rowFor(item.id);
  if (item.kind === 'case') {
    if (equivalentRows.includes(row.normalizedId)) return { category: 'VERIFIER', cause: 'DIAGNOSTIC_EQUIVALENT_WORDING', refs: ['matcher', 'case'], unqualified: ['Contextual diagnostic acceptance under unchanged frozen condition', 'assertPhase and cleanup assertions following the failed matcher were not reached; raw observations are not passes'], continuation: 'VERIFIED_MECHANICAL_CORRECTION' };
    assert.ok(heldRows.includes(row.normalizedId));
    return { category: 'POLICY_TENSION', cause: 'DIAGNOSTIC_SPECIFICITY_HOLD', refs: ['matcher', 'case'], unqualified: [`Whether generic diagnostic identifies the frozen condition: ${row.condition ?? row.ruleText}`, 'Remaining phase and cleanup subassertions after diagnostic assertion'], continuation: 'ROOT_DECISION_BEFORE_ANY_MATCHER_CHANGE' };
  }
  if (item.kind === 'phase') return { category: 'VERIFIER', cause: 'OUTPUT_FLAGS_AFTER_DOUBLE_DASH', refs: ['phase', 'argument'], unqualified: [row.phase === 'BEFORE_IO' ? 'Intended selector syntax/numeric validation before acquisition/metadata, not accidental too-many-files refusal' : 'Read first logical header only; exact delivery/read-ahead charge and one owned release before selected output', 'Correct condition diagnostic', 'No out.csv publication and unchanged input for the intended invocation, not the malformed invocation'], continuation: heldRows.includes(row.normalizedId) ? 'ARGUMENT_CORRECTION_READY_DIAGNOSTIC_POLICY_HELD' : 'VERIFIED_MECHANICAL_CORRECTION' };
  if (item.kind === 'workflow') return { category: 'VERIFIER', cause: 'MIDDLEWARE_DISCARDS_COMMAND_RESULT', refs: ['workflow', 'resultContract'], unqualified: ['Successful Shell status and empty stderr', 'Assertions after exitCode failure: expected workflow output, intermediate file bytes when applicable, middleware before/after counts, cwd/exported KEEP', 'Frozen parent unchanged/shared budget identity/cumulative counts and pipeline stage-byte observations were not established by this bridge'], continuation: 'VERIFIED_MECHANICAL_CORRECTION_NOT_FULL_F01_REPLACEMENT' };
  if (item.kind === 'origin') return { category: 'VERIFIER', cause: 'MIDDLEWARE_DISCARDS_COMMAND_RESULT', refs: ['origin', 'resultContract'], unqualified: ['Successful empty-input headers invocation with preserved stdinIsDefault; origins assertion observed but status not qualified'], continuation: 'VERIFIED_MECHANICAL_CORRECTION' };
  if (item.kind === 'shell-lifecycle') return { category: 'VERIFIER', cause: 'ASYNC_BRIDGE_AND_MIDDLEWARE_LOSE_PROVENANCE', refs: ['provenance', 'routeContract', 'routeImplementation', 'diagnostic'], unqualified: [item.id.endsWith('escaping-over-local') ? 'Actual escaping sink failure wins local invoke cancellation at authenticated promise boundary' : 'Mapped numeric status must not become escaping failure; local cancellation retains identity at authenticated promise boundary', 'Existing cleanup gate observations do not authenticate missing child rejection provenance'], continuation: 'REMOVE_VERIFIED_CONFOUNDS_ONLY_KEEP_PRECEDENCE_ASSERTIONS_NO_PRODUCT_PASS_PREDICTION' };
  if (item.kind === 'ledger') return { category: 'POLICY_TENSION', cause: 'F11_DIAGNOSTIC_VERSUS_WORK_CAPACITY', refs: ['ledger', 'diagnostic', 'budget', 'managed', 'scanner', 'writer', 'count', 'inputScope'], unqualified: ['Exact frozen runtime-limit diagnostic when output allowance fits versus prohibition of any out-of-budget emergency work/capacity', 'Full independent normative work/capacity ledger is not certified by implementation-counter arithmetic'], continuation: 'ROOT_POLICY_DECISION_NO_QUOTA_EXEMPTION_OR_MINIMUM_RAISE' };
  if (item.id === 'F10-authority-conflict') return { category: 'VERIFIER', cause: 'TWO_AUTHORITY_CONFLICT_NOT_INJECTED', refs: ['authority'], unqualified: ['Conflicting distinct operand authorities queried once each and EIO before destructive publication; a single same answer is not conflict'], continuation: 'OUTSIDE_FOUR_MECHANICAL_FAMILIES_NEW_RECIPE_AUTHORIZATION' };
  if (observation.error?.reviewDeadline) return { category: 'RESOURCE_CUTOFF', cause: 'COOPERATIVE_35_SECOND_ABORT', refs: ['resource'], unqualified: ['Complete target charge and boundary status; complete output digest/semantics and required failure diagnostic', 'Partial digest/byte counts and cleanup only; no completed default-scale proof'], continuation: 'FRESH_BOUNDED_RESOURCE_RECIPE_ROOT_AUTHORIZATION' };
  if (observation.executed === false) return { category: 'VERIFIER', cause: 'DEFAULT_WORK_CAPACITY_LEDGER_UNIMPLEMENTED', refs: ['unmet'], unqualified: ['Independent source event/lifetime ledger attaining exact default L-1/L/L+1 charge', 'Actual runtime boundary admission/refusal and diagnostics at that target'], continuation: 'OUTSIDE_FOUR_MECHANICAL_FAMILIES_NEW_RECIPE_AUTHORIZATION' };
  if (item.id.includes('maxSelectorDepth')) return { category: 'VERIFIER', cause: observation.target === 1 ? 'GENERATOR_OMITS_DEPTH_ONE' : 'NO_LEGAL_DEPTH_THREE_WITNESS', refs: ['depth'], unqualified: [`Runtime depth target ${observation.target}; prepared generator always chooses depth 2`, observation.target === 1 ? 'Recipe omission is not evidence that depth one is impossible' : 'Frozen nonrecursive depth ceiling has no legal depth-three runtime witness; configuration rejection is separate'], continuation: 'OUTSIDE_FOUR_MECHANICAL_FAMILIES_KEEP_NONPASS' };
  assert.ok(item.id.includes('maxOutputBytes') && observation.target % 2 === 1);
  return { category: 'VERIFIER', cause: 'GENERATOR_ONLY_EVEN_OUTPUT_SERIALIZATION', refs: ['oddOutput'], unqualified: [`Exact odd output-byte target ${observation.target}, complete bytes/digest and boundary outcome; generator parity limitation is not product impossibility`], continuation: 'OUTSIDE_FOUR_MECHANICAL_FAMILIES_NEW_RECIPE_AUTHORIZATION' };
}

const cases = [...review.failures, ...review.unrun].map(item => {
  const records = evidence.cases.get(`${item.layout}/${item.id}`);
  assert.ok(records);
  const raw = records.find(value => value.record.stage === 'RAW_OBSERVATION');
  const outcome = records.find(value => value.record.stage === 'CASE');
  assert.ok(raw && outcome, 'no missing raw may be silently fabricated');
  assert.equal(outcome.path, item.raw);
  const expectedStatus = review.failures.includes(item) ? 'FAIL' : 'BLOCKED';
  assert.equal(outcome.record.status, expectedStatus);
  const observation = raw.record.observation;
  const diagnosis = classify(item, observation);
  const directlyMapped = obligations.obligations.filter(obligation => obligation.actualIds.includes(item.id));
  const mapped = directlyMapped.length ? directlyMapped : obligations.obligations.filter(obligation => obligation.actualIds.includes(`${rowFor(item.id)?.normalizedId}/P0`));
  assert.ok(mapped.length);
  const entry = evidence.entries.find(value => value.path === item.raw);
  const retention = item.kind === 'workflow'
    ? item.id === 'F01-pipe' ? 'Shell final stdout/stderr retained; pipeline intermediate stage bytes NOT captured (stageBytes=[]), not empty intermediate output' : item.id === 'F01-alias-h' ? 'Second Shell result retained; first alias stdout checked in-memory, first full result NOT retained' : 'Final Shell result and both intermediate files retained'
    : observation.stdout ? 'Input/output digest and byte count retained, payload NOT retained; stdoutBase64 is the unused collector, not evidence of zero emitted bytes'
      : 'Exact RAW_OBSERVATION retained; fields absent from it were not captured, not inferred empty';
  const summary = { ...observation };
  if (summary.result) summary.result = { ...summary.result, stdoutBytes: undefined, stderrBytes: undefined };
  const frozenCase = rowFor(item.id);
  const flagArgv = {
    'flag-3-B01-R1-repeat': ['count', '-nn'],
    'flag-4-B01-R6-L-range': ['slice', '--last=0', '--len=0'],
    'flag-5-B01-R6-I-range': ['slice', '--indices=0', '--start=1'],
    'flag-6-B01-R6-L-I': ['slice', '-L0', '-I0'],
    'flag-7-B01-R7-invalid-plural': ['slice', '--indices=x'],
  };
  const actualArgv = item.kind === 'phase' ? [...frozenCase.argv, 'input.csv', '-o', 'out.csv'] : flagArgv[item.id] ?? frozenCase?.argv ?? observation.argv ?? (item.kind === 'ledger' ? ['count'] : null);
  return {
    layout: item.layout, id: item.id, originalStatus: expectedStatus, ...diagnosis,
    rawBinding: { archive: evidence.evidence.path, archiveSha256: evidence.evidence.sha256, revision: resultCommit, ...entry, observationLine: raw.line, observationLineSha256: raw.lineSha256, outcomeLine: outcome.line, outcomeLineSha256: outcome.lineSha256 },
    frozenCase: frozenCase ?? null,
    actualArgv,
    obligationMapProvenance: directlyMapped.length ? 'ORIGINAL_ACTUAL_IDS' : 'ORIGINAL_FLAG_VARIANT_NOT_LISTED_DIAGNOSIS_BINDS_ORIGINAL_ID_P0_NO_PASS_CREDIT',
    obligations: mapped.map(({ id, kind, input, pointer, subtreeSha256 }) => ({ id, kind, input, pointer, subtreeSha256, qualification: 'UNQUALIFIED_SUBASSERTIONS_LISTED_NOT_OBLIGATION_PASS' })),
    originalFailure: outcome.record.failure ?? null,
    observation: summary,
    retention,
    executed: observation.executed === false || observation.reachability ? false : true,
    originalAttemptedFlag: item.attempted,
  };
});
assert.equal(cases.length, 195);
const counts = {};
for (const item of cases) {
  const key = `${item.layout}/${item.originalStatus}/${item.cause}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
for (const layout of ['SOURCE', 'INSTALLED_MOVED']) {
  assert.equal(cases.filter(item => item.layout === layout && item.originalStatus === 'FAIL').length, 79);
  assert.equal(cases.filter(item => item.layout === layout && item.originalStatus === 'BLOCKED').length, layout === 'SOURCE' ? 19 : 18);
}
const files = {
  'CASES.json': { classification: 'POSTCANDIDATE_STATIC_DIAGNOSIS_NO_RESCORE_NO_PRODUCT_RUN', counts, cases },
  'BINDINGS.json': { candidate, base, freeze, resultCommit, originalRecipe: review.originalRecipe, continuationRecipe: review.continuationRecipe, evidence: evidence.evidence, sourceBindings, references: refs, immutableReviewCounts: review.result.perLayout, obligationMappingsNotPasses: obligations.mapped },
  'CORRECTIONS.json': { classification: 'VERSIONED_MECHANICAL_PROPOSAL_NOT_INSTALLED_OR_PRODUCT_QUALIFIED', equivalentRows, heldRows, transforms: proposal(), admissionChanges: [], productChanges: [], expectedStatusChanges: [], f11MatcherChanges: [] },
};
if (process.argv[2] === '--patch') {
  process.stdout.write('*** Begin Patch\n');
  for (const [name, value] of Object.entries(files)) process.stdout.write(`*** Add File: ${owned}${name}\n${(JSON.stringify(value, null, 2) + '\n').split('\n').slice(0, -1).map(line => `+${line}`).join('\n')}\n`);
  process.stdout.write('*** End Patch\n');
} else {
  for (const [name, value] of Object.entries(files)) assert.deepEqual(json(`${owned}${name}`, process.argv[2] ?? 'HEAD'), value);
  console.log(JSON.stringify({ classification: 'READONLY_ARCHIVE_DIAGNOSIS_REPRODUCED', cases: cases.length, counts, files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(JSON.stringify(value, null, 2) + '\n')])) }));
}
