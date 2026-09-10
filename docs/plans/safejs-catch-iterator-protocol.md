# Catch binding iterator protocol

## Validated defect

At runtime d4891dd09, public guest execution of array catch patterns only accepts
arrays and reads their indexed elements directly. It rejects strings, Sets,
generators and custom iterables, and ignores an array's overridden iterator.
`exceptions.ts` has a separate `bindArrayPattern` with an `Array.isArray` guard;
the general `patterns.ts` implementation already uses the iterator protocol.

A read-only comparison of 72 combinations found 12 differences, all in catch
bindings (6d427d). Declaration, assignment, parameter, elision and rest controls
matched native execution. The cases vary failure in `next`, `done`, or `value`,
and close returning an object, returning a primitive, or throwing. Effects are
compared as well as final results, so an incidental matching TypeError does not
count as correct cleanup behavior.

## Isolated red regression

An unchanged source copy is at `/tmp/safejs-catch-iterator.JFY5Sw`, with root
dependencies linked to the main checkout. Its new
`packages/safe-js/src/interp/catch-iterator-protocol.test.ts` has 18 cases.
The initial run reports **17 failures and one array control pass** (c5d2ba).
Besides the 12 failure/close cases, it checks Set, Unicode string iteration,
overridden array iteration, generator closing, and an empty catch pattern.
## Candidate implementation and follow-up evidence

The isolated candidate now supplies a typed catch-binding callback from the
interpreter into the exception evaluator. It uses `bindPattern` and
`createPatternContext` with the actual catch scope. The separate array/object
catch binding implementation was removed, rather than kept as a fallback.
The original 18 cases and existing exception tests pass: 31 tests (285983).
Additional default-throw cleanup, TDZ, inferred names, nested Map destructuring
and elision cases pass. Seven focused exception/pattern/recovery files pass
94 tests (05095c).

A new isolated checkpoint file,
`src/snapshot/guest-generator-catch-iterator.test.ts`, reports four passes and
four failures (6ff235). Sync/async checkpoints inside catch bodies pass for
Sets and generators. Yielding inside catch parameter defaults and restoring
loses the earlier initialized binding `a`, for both arrays and Sets. This is
a real recovery gap and the candidate is not ready to integrate.

Next inspect catch-scope persistence and the strict block/expression-state
snapshot validators. Do not simply accept arbitrary block-scope IDs or skip
binding validation. The general array-pattern continuation preserves its
iterator/index, but catch currently creates a fresh lexical scope on entry.
The native comparison expects the earlier `a` and resumed `b` to survive.
Candidate typecheck/lint session 10582 completed successfully (2e1c2f), before
the subsequent scope-recovery changes.

## Catch-scope recovery candidate

Catch scope is now retained under the CatchClause AST identity in the existing
scope map. Parameter initialization also retains the original thrown value in
an existing pattern-source expression record. Resumption recognizes the whole
handler, not only its body, avoiding repeated execution of the try block.
An existing restored catch scope is reused without predeclaring its initialized
bindings again. Body resumption still skips completed parameter binding.

The AST validator derives the exact expected CatchClause scope from the yield
path and expects the catch source only while inside the parameter. The restore
path accepts BlockStatement or CatchClause nodes for scope records; arbitrary
IDs remain rejected by source-ownership validation.

The eight initial sync/async checkpoint cases pass (0455d8). The expanded
selection passes 21 tests (d9c874): object/default/computed keys, rest, nested
catches, effect counts and four missing/unrelated scope/source corruptions.
The candidate full snapshot selection is running in session 19063 with report
`/tmp/safejs-catch-snapshot-candidate-results.json`. Scoped lint passed (d2de5d).
TypeScript session 9411 found two AST type assumptions: resume-target accepted
only ParseResult and the restore scope discriminator excluded CatchClause.
The candidate explicitly admits CatchClause in resume-target's input type and
checks the restored scope node's string discriminator against only the two
supported scope-bearing types. These are type-only changes; a fresh TypeScript
check is running in session 30946. Do not integrate based only on focused passes.

## Compatibility review and broader checks

TypeScript session 30946 passed (78dee1). Review then identified that retaining
the CatchClause scope while executing the body would unnecessarily change valid
older body snapshots. The candidate now records that extra scope only during
parameter binding, and the AST validator expects it only on that path. Body
scope records keep their previous shape. The updated focused protocol,
checkpoint and AST-ownership selection passes 52 cases (6e9c35).

Three public dump snapshots created by unchanged main are accepted by the
candidate (a8343c). Six old-runtime internal snapshots, spanning sync/async
generators and destructuring/simple/omitted catch parameters, restore and resume
to the expected final result (d25e34). This checks actual execution, not merely
acceptance.

Candidate snapshot run 19063 completed successfully: 2,186 passes, zero failures
or skips, 160 files (0ee270). The parameter-only scope refinement occurred while
that run was active, so this is broad candidate evidence, not a clean immutable
final-source gate. The 52-case focused check covers that refinement separately.
Final candidate lint/TypeScript command 52420 passed (c6c51f).
The checkpoint suite was then expanded to repeated JSON recapture/restoration:
two defaults, transition into the body, and closures over earlier initialized
bindings. All 27 cases pass (a4e056), including sync/async execution. The runtime
did not change for that expansion. Main integration session 69114 remains live
and main sources unchanged; PID 60496 was using 192.7% CPU after 10:49 (33e526).

## Repair requirements

Prefer sharing the maintained binding/iterator implementation over perpetuating
the array-only catch path. Preserve catch lexical scope, TDZ, inferred default
names, error completions, iterator close precedence, resource accounting and
generator/async recovery. Inspect the standalone exception evaluator contracts
before changing its interface. Add tests for defaults, elisions and checkpoint
recovery, not just successful Set binding.

Main full gate session 69114 is still running and main runtime/test sources must
remain stable until it terminates. Develop the candidate in the isolated copy,
then revalidate and integrate as a separate atomic improvement. No push/release
or issue closure during the release hold. This language-only change has no CLI
visual impact; update README on integration.
