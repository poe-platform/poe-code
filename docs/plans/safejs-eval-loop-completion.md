# Eval loop completion values

## Validated mismatch

The 18 native-VM comparison cases in
`packages/safe-js/src/interp/globals/eval-loop-completion.test.ts` initially
produced 16 failures and two passing controls. While and do-while discarded
body values and returned empty completion, incorrectly preserving a preceding
script expression even for an empty loop. Nested labeled break/continue cases
also lost their values.

## Implementation

Use the existing budget-retained StatementCompletion for eval-mode while and
do-while, initialized with a non-empty undefined value. Update it with body
completions, preserve values on outward abrupt control flow, and release its
retention callback in finally. Test expressions do not replace the body value.
Ordinary function execution does not enable eval completion mode.

## Verification

- RED: 16 failing native comparisons, two passing controls.
- GREEN: all 18 comparisons pass; existing eval statement-completion and
  suspended eval-call recovery tests bring this selection to 45 passes.
- Further regression selection: 77 passes across generator do-while snapshot
  restoration, basic eval, eval-source recovery and eval budget tests.
- SafeJS TypeScript check, focused ESLint and git diff whitespace check pass.

## For and switch follow-up

The 22 native comparisons in `eval-for-switch-completion.test.ts` reproduced
21 failures and one passing control before implementation. They cover empty
loops, ignored initializer/update values, labeled break/continue, switch
fallthrough/default selection, declarations with empty completion, and explicit
undefined replacement.

For and switch now use the same retained completion state in eval mode. The
for-loop state remains live through resource-scope disposal, and its callback
is released in finally. Ordinary for-loop execution retains the existing
promise-return path without an additional await.

All 118 tests pass in the selection containing these new cases, previous
eval while/do-while and statement cases, generator switch snapshots and
generator for-loop continuation snapshots.
The SafeJS TypeScript check, focused ESLint and whitespace check also pass for
this follow-up.

## For-in and for-of follow-up

The 20 native comparisons in `eval-iteration-completion.test.ts` initially
produced 17 failures and three passing controls. They include null/undefined
for-in operands, empty iterations, body values, nested labeled exits, and
iterator cleanup on break. The cleanup-throws control already matched native.

Both iteration paths now retain eval completion values until exit. For-of
passes the completed result through iterator close and keeps it budget-retained
until cleanup finishes; throwing cleanup still replaces the normal completion.
For-in's null/undefined shortcut explicitly returns a non-empty undefined
completion in eval mode. Ordinary execution remains empty-completion based.

The five-file iteration, previous loop-completion, generator for-in snapshot
and generator iteration-continuation selection passes all 141 tests.
An additional 50 tests pass for iterator close, suspended eval-call restoration,
eval-source recovery and retained-source budgets. SafeJS TypeScript, focused
ESLint and whitespace checks pass.

## With follow-up

Twelve sloppy eval comparisons use native and guest Function constructors to
provide a non-strict caller. Five cases initially fail: empty with bodies,
declaration-only bodies, empty labeled breaks and continues, and nested empty
with statements incorrectly preserve preceding values. Seven controls already
pass, including values, property resolution and exceptions.

Eval-mode with now converts an empty body completion to non-empty undefined,
preserving its completion kind and label. Non-eval execution keeps the original
promise-return path. All 125 tests pass across the five completion test files
and existing dynamic-with execution/snapshot tests.
SafeJS TypeScript, focused ESLint and whitespace checks pass for this follow-up.

This remains part of the uncommitted eval implementation. The separately
recorded declaration-instantiation defects still need fixes. The full
integration candidate does not include eval. No push or release is authorized.
