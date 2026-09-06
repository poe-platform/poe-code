# Issue 644: bounded jq control flow

## Root integration review

Root independently passed 124 focused jq/yq/resource tests, 98 maintained
integration-registry tests, and a fresh `typecheck:all` build with all 26 consumer
groups. Logs are `issue644-root-focused.log`, `issue644-root-registry.log` and
`issue644-root-types.log` below
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp`.

A different reviewer matched ten additional nested control-flow observations
against the verified jq 1.8.2 oracle and checked eight bounded resource/lifecycle
controls. These cover AST/frame depth, charged lookup, hidden empty extraction,
empty-initializer source suppression and early retirement without prefetch.
No concrete blocker was found; production hashes stayed unchanged. Root's six
separate native controls also confirmed the selected initializer/update behavior.
These scoped results are not a full maintained gate or delivery qualification.

Root removed only the now-resolved descent/reduce/foreach/try-catch limitation
substrings from the structured README. An exact deletion-only transformation was
verified; no README content was added. Existing profiles and remaining gaps stay
unchanged.

Baseline: `d17a11832251969d2b7406736cc17b80b36408b0` (September 5, 2026).

## Scope

Implement recursive descent, reduce, foreach (including extract), and try/catch
only in the shared structured parser and interpreter. Exercise both jq and yq.
No host capabilities, dependencies, generic diagnostic changes, or limit changes.
User functions/modules, standalone as bindings, recursive assignment paths and
the absent error/0 and error/1 builtins remain out of scope.

## Sequence

1. Independently reproduce the missing constructs with semantic failing tests.
2. Add bounded AST nodes and lexical validation; bind loop variables only inside
   update/extract, preserving outer bindings in the source and initializer.
3. Stream traversal and iteration with one shared Budget, bounded lexical frames,
   last-update accumulation, null after an empty update, and independent extract.
4. Catch evaluator JqError only, excluding limits, cancellation and arbitrary host
   failures; retain early generator retirement and output backpressure.
5. Run focused tests, notify root before the maintained typecheck:all build, and
   report exact evidence and remaining native differences. Root owns registry,
   Git, full qualification and release.

## Oracle boundary

Root selected actual jq 1.8.2 behavior for new constructs after the independent
58-case replay (49 unchanged, nine different from jq 1.7.1). Foreach replays the
original source input for each initializer; reduce uses null after the first.
Existing jq 1.7.1-apple numeric/assignment/diagnostic behavior is not migrated.
See `packages/safe-bash/src/contracts/jq-control-flow.md` for precise semantics,
examples, safety boundaries and deliberate gaps. No README edits are authorized.

## Validation record

- Node v22.22.0 from `/tmp/kamilio-toolchain.path`; TMPDIR is the validation-root
  `tmp`; `TSX_DISABLE_CACHE=1`; normal node:test child isolation/concurrency 1.
- Initial sandbox child-start failures were rerun escalated, not counted as RED.
  An initial yq test used unsupported flags; those were corrected to the existing
  `-o json -c` profile before the independent baseline run.
- Baseline semantic RED: 81 tests, 13 pass, 68 fail, no skip/cancellation.
  `/tmp/issue644-red-corrected.log` preserves that run before either source edit.
- The first implementation run was 80/81; the remaining yq close assertion was
  corrected to its inspected existing closed-session rejection contract, with no
  query-core change.
- Root-selected multiple-initializer RED: 113 tests, 109 pass, four fail across
  jq and yq, before the reduce source-input correction. Evidence:
  `/tmp/issue644-multiinit-red.log`. Subsequent GREEN: 113/113 in
  `/tmp/issue644-green.log`. Final lifecycle/work-expanded cohort: 117/117,
  no skips/cancellations, in `/tmp/issue644-green-final-typed.log`.
- Existing focused regression run: 2472/2473 pass. One assertion in existing
  `packages/safe-bash/tests/commands/structured/resources.test.ts` expects the
  old `expected property` diagnostic for malformed `..a...`; recognizing the new
  `..` token correctly rejects it with an unexpected-identifier syntax error.
  Root disposition is required; no out-of-scope test edit or diagnostic workaround
  was made. `/tmp/issue644-regression.log` preserves the failure.
- Ad hoc product replay of the exact saved jq 1.8.2 cohort: 50/58 byte-identical,
  eight differences preserved in `/tmp/issue644-native-differential.jsonl`.
  Three use the still-absent error/1 builtin; two differ in existing compiler
  diagnostics; three differ in existing index-error wording (one visible in
  successful catch stdout). These are not discarded or counted as parity.
- Source was frozen and root notified before the only shared build. Maintained
  `npm run typecheck:all` built successfully, then found TS2769/TS7006 in the
  new sink-failure test's CommandResult-or-Promise use. Its full failed evidence
  remains `/tmp/issue644-typecheck-all.log`. The test now normalizes that union
  with Promise.resolve; product source and generated declarations are unchanged.
  Maintained `npm run typecheck` then passed source/tests, the historical consumer,
  three source-consumer routes, 26 current consumer groups and expected negative
  controls, with no second build. Evidence: `/tmp/issue644-typecheck-final.log`.
- Root registered the three literal test paths separately; that root-owned edit
  is not part of this worker's patch. No full guard, Git delivery, release or
  global-parity claim. The existing malformed-depth fixture remains root-owned.

## Root-authorized depth fixture correction

Root subsequently authorized only the existing depth-limits case in
`packages/safe-bash/tests/commands/structured/resources.test.ts` and a separate
malformed-input control. The initial 2472/2473 regression result remains in
`/tmp/issue644-regression.log`; no production source or diagnostic was changed.

The old `"." + ".a".repeat(1000)` starts with malformed `..a`, so it never
tested a valid deep property chain. The corrected `".a".repeat(1000)` does.
All three valid deep filters now require status 5, empty stdout and maxAstDepth,
without accepting an expected-property error, and still reject RangeError or
call-stack diagnostics. A separate `..a` test pins status 3, empty stdout and
the exact current unexpected-IDENT diagnostic, including its existing spacing.
Focused rerun: 124/124 pass (the 117 new controls plus seven resource controls),
with no failures, skips or cancellations, recorded in
`/tmp/issue644-depth-focused.log`.

The exact previous regression file selection now passes 2474/2474, with no skips
or cancellations, in `/tmp/issue644-depth-regression.log`. Its original 2473
tests remain selected; the extra case is the separate malformed `..a` control.
The initial failure is resolved by correcting and strengthening the fixture,
not by weakening its accepted diagnostics or changing production behavior.

This authorized follow-up changes only the resource test and this plan. The
parser/interpreter hashes remain unchanged from the prior freeze. No shared
build, typecheck, registry, Git or full guard was run for this test-only follow-up.
The corrected fixture and plan are frozen for root review and qualification.

## Root-authorized retained-seal migration

Root reported HEAD `f5ab683e8`, with the production/fixture change committed in
`f6fd36ba1`. Root's full build passed, but its full npm test was interrupted by
actual ENOSPC. The gate directory
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-644-gate.7jV5d0` has truncated
8,192-byte logging and no gates.status; it does not establish a completed test
gate. After space recovery, root's package-CWD rerun passed 52/53, including all
six split interop backends, and identified the retained resources source seal.
That failure is preserved in the validation root's
`tmp/issue644-post-space-failures.log`.

### Previous regression selection was not complete package coverage

The earlier 2473/2474 runs used CWD `/home/kjopek/project/poe-code`, Node 22 with
`--import tsx --test --test-concurrency=1`, and these exact twelve files after
expanding `packages/safe-bash/tests/commands/structured/*.test.ts`:

- `packages/safe-bash/tests/commands/structured/byte-ownership.test.ts`
- `packages/safe-bash/tests/commands/structured/cli.test.ts`
- `packages/safe-bash/tests/commands/structured/resources.test.ts`
- `packages/safe-bash/tests/commands/structured/semantics.test.ts`
- `packages/safe-bash/tests/commands/structured/streaming.test.ts`
- `packages/safe-bash/tests/commands/structured/string-work.test.ts`
- `packages/safe-bash/tests/commands/structured-stress/regressions.test.ts`
- `packages/safe-bash/tests/commands/structured-stress/safety.test.ts`
- `packages/safe-bash/tests/commands/structured-stress/jq-grammar-author-20260827/grammar.test.ts`
- `packages/safe-bash/tests/commands/structured-stress/jq-grammar-author-20260827/limits.test.ts`
- `packages/safe-bash/tests/commands/structured-stress/jq-42-author-20260827/native.test.ts`
- `packages/safe-bash/tests/commands/yq-author-20260828/yq.test.ts`

This selection omitted the active
`tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts` seal and
the split interop file. The separate 117 new controls were not members of that
2474-test regression selection either. These were focused results, not complete
package coverage or qualification of all outward retained-evidence dependencies.

### Dependency inspection and exact authority

Before editing, a bounded literal-reference/current-digest search covered root
scripts, package scripts, structured stress fixtures and plugin evidence. The
test-duration weight entry is a path/task weight, not a source-content seal.
The explicit historical consumers `jq-grammar-seal-proposal/verify.mjs` and
`jq-grammar-seal-final/review.mjs` assert the earlier unapplied seal-test image;
those assertions already differ from the unmodified current evidence test.
`jq-grammar-proposal-review/review.mjs` also consumes its historical manifest.
None were edited or executed. No additional current fixed binding to the
unmodified evidence-test digest was found in this bounded search, nor a current
production/root-maintained-script consumer requiring another edit. This is not
global nonexecution or liveness clearance; root retains full qualification.

The final outward-dependency check also inspected the maintained test route:
`scripts/test.mjs` calls `discoverTests` from `scripts/integration-inputs.mjs`,
whose active membership glob is `tests/**/*.test.ts`, and launches tests with
package CWD. The evidence test remains in that route; no selection was changed.
Its existing `scripts/test-duration-weights.json` weight remains 293. The
source/test typecheck configuration still includes `tests/**/*.ts` unchanged.
The new receipt has exactly one executable TS/MJS/JS reference in the inspected
source/script/test trees: its literal owner, this evidence test; the other
reference is this plan. No current fixed digest dependency on the unmodified
evidence-test hash was found.

The expanded reference search also identified the unchanged historical
`jq-42-review-fixes/{seal,immutable}.mjs`,
`jq-42-independent-final/{seal,immutable}.mjs`,
`jq-grammar-source-review/validate.mjs` and
`jq-grammar-final-review/finalize.mjs`. These preserve commit/snapshot verification,
historical result processing and opt-in replay paths; they are not selected as
test files by the maintained test glob. Their old source/manifest assertions
already differ from the unmodified current tree. No retirement/exclusion or
global nonexecution claim is inferred, and none was edited or run. Inspection
identified no additional current binding requiring an out-of-scope update; root
still owns the fresh full gate and any later concrete dependency disposition.

Root authorized one explicit maintenance migration for the already-approved
resources fixture strengthening. The new literal
`tests/commands/structured-stress/jq-42-review-fixes/resource-depth-receipt-644.json`
has exactly one member and one replacement block at byte offset 2986. Its 1735
bytes are pinned by SHA-256
`42afb49e94f3528829d9a26cf2aaf9d3d14eba4ad556ec1e27fbf0d1dbf6625c` in its literal
owner, `tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`.

The migration authenticates the exact member selector, owner, receipt path,
receipt length and digest before JSON parsing. It authenticates the complete
6495-byte current fixture (`55e0aecebc8c3e2deb3b78d90fcb612a54103866b7d8b2488900b2dcf1ba4a91`)
and the complete 6029-byte original snapshot
(`c61d9f482fc8c76a432d962a134c7834e4fb381a9a501e94b92dc27f79012061`). Reversing only
the approved block in memory must reproduce that snapshot byte-for-byte and
pass its original expected hash. The normal original-hash assertion remains in
the aggregate seal after reconstruction. No source is restored on disk.

All 140 current members and all 23 original historical snapshots remain checked.
The four spelling migrations and one unused-binding migration are unchanged;
exactly one resource-depth migration is added. Both unchanged-image diagnostic
counters now honestly report 134 byte-unchanged members:
`140 = 134 + 4 spelling + 1 binding + 1 depth`. The prior 136-member count outside
spelling migrations remains asserted, with an accurate label. Historical
manifests, snapshots, exclusions, retirement decisions and production sources
are unchanged.

### Focused verification and freeze

All new runs use CWD `/home/kjopek/project/poe-code/packages/safe-bash`, the Node
22 toolchain selected by `/tmp/kamilio-toolchain.path`, validation-root `tmp` as
TMPDIR, `TSX_DISABLE_CACHE=1`, and normal node:test isolation/concurrency 1.

- Independent pre-edit seal RED: 47 tests, 46 pass and one failure, in
  `/tmp/issue644-depth-seal-red.log`.
- Before aggregate migration wiring, 69 controls yielded 67 passes and two
  failures: the original seal plus a new negative-control setup whose replacement
  needle did not actually mutate its input. Both are preserved in
  `/tmp/issue644-depth-seal-controls-red.log`; the needle was corrected, not the
  accepted fixture or the rejection assertion.
- Final focused GREEN: 199/199 pass, no failures/skips/cancellations, in
  `/tmp/issue644-depth-seal-focused.log`. This comprises 69 seal tests (47
  existing plus one depth acceptance and 21 negative controls), seven resource
  tests, the 117 new control-flow tests, and all six split interop backends.
- New negatives reject wrong member/path/old hash/owner/receipt path, aliases,
  malformed/truncated/extended/rewritten receipts, extra receipt members,
  selector changes, same-size/extra source edits, weakened status assertions,
  malformed-source rollback, diagnostic drift, snapshot mutation/extension and
  restoration of the old fixture. Invalid receipt/selectors are explicitly
  proven rejected before JSON.parse is called. All mutations are in memory.

The focused command selected these package-relative files:

```sh
node --import tsx --test --test-concurrency=1 \
  tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts \
  tests/commands/structured/resources.test.ts \
  tests/commands/jq-control-flow.test.ts \
  tests/commands/jq-control-flow-limits.test.ts \
  tests/commands/yq-control-flow.test.ts \
  tests/commands/structured-stress/split-increment/interop.test.ts
```

This follow-up edits only the evidence test, its new literal receipt and this
plan. They are frozen for root review. No production, resource-fixture, Git,
build, typecheck or full-guard changes/actions were made; fresh full gates and
delivery remain root-owned.

### Root review before the replacement full gate

On September 6, 2026, root independently reran the six-file cohort from the
package directory: 199/199 pass, with the 140-member/23-snapshot accounting
intact. The exact registry check passed 98/98, and maintained `npm run typecheck`
passed all 26 current consumer groups and its expected negative controls.
Logs are in the validation root's `tmp/issue644-root-depth-seal-focused.log`,
`tmp/issue644-root-depth-seal-registry-corrected.log` and
`tmp/issue644-root-depth-seal-types.log`.

The first root registry invocation mistakenly used repository CWD for the
package-relative script and failed before test discovery. Its diagnostic is
preserved in `tmp/issue644-root-depth-seal-registry.log`; the corrected invocation
used package CWD. This was a command-path error, not a product failure or a pass.
Production sources, the strengthened resource fixture and immutable manifests
remain unchanged by this maintenance follow-up. A fresh frozen full build,
`npm test`, typecheck and lint run is still required; these focused results do
not establish push or release delivery.
