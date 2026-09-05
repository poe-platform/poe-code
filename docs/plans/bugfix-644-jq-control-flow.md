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
