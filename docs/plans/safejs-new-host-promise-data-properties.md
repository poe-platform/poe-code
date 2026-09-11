# New host Promise data properties during replay

## Validated gap

The own-string Promise import implementation preserves initial property reads,
but newly encountered Promises inside host return values still cannot be
recorded if they have own properties. This differs from initial input Promises,
which have explicit replay capability identities and property graphs.

The isolated regression is
`/tmp/safejs-new-promise-capability.KGfWqD/packages/safe-js/src/run.host-promise-data-properties.test.ts`.
Both synchronous and asynchronous host-return controls first produce the
expected label, self-alias identity, and settlement value. Their first dump
then throws `Snapshot is not replayable`, requiring an explicit resume
capability. Both tests fail (1ae24e), report
`/tmp/safejs-new-host-promise-properties-red.json`.

The replay encoder only permits new imported settled/pending Promises when
their property table is empty. Own-string import now makes legitimate host
data visible in that table, exposing the existing recording restriction.

## Required repair and verification

Preserve newly imported Promise data in recorded host outcomes, including
descriptors, aliases, self-cycles, and nonextensibility. Preserve original
recorded data rather than later guest mutations. Pending-to-settled proof
replacement must not discard properties. Decode must enforce allocation
limits and rollback on malformed graphs; existing property-free snapshots
must stay compatible. Callable properties need explicit capability handling,
not silent data-only substitution. Symbol/accessor transport remains separate.

Keep this work isolated while main snapshot session 28575 qualifies the input
property feature. Main source is unchanged by this reproducer. Do not claim
new-host property replay is fixed based on input capability tests.

## Isolated implementation and follow-up failure

The first isolated repair adds optional property graph references to settled
and pending imported Promise nodes, validates an ordinary property-table node
on decode, and retains that reference when a pending proof replaces the node
with its settlement. The original two failures now pass, together with the
five maintained nested-host Promise controls (89822b).

A new original-data mutation control fails (a266d9): first execution reads
count zero and increments it, but completed replay reads one rather than zero.
The two initial controls still pass. Report:
`/tmp/safejs-host-promise-property-mutation-red.json`.
The current encoder reads live property tables at dump time, and ordinary
`cloneSandboxValue` preserves Promise identity, so copying the surrounding
host outcome alone cannot preserve original property data. Capture needs to
occur before guest exposure, preserve Promise identities in cycles, and be
restored before replay resumes. Retained captured data must be accounted for
by the existing memory budget. Do not integrate the first repair as complete.

Pending checkpoints, malformed graph rollback, allocation bounds, and callable
properties also require direct qualification after original-data capture.

An isolated capture map now retains imported property data when host outcomes
or imported settlements are copied, before guest mutation. Ordinary cloning
dropped non-enumerable self references, demonstrated by two public failures
(bc187f/e7b9bb) and a direct capture failure (a4ed3e). Descriptor-aware capture
corrects that regression; all nine tests across the public new-host cases,
direct capture, and maintained nested-host replay now pass (030dae).

This candidate adds retained-data traversal for captured properties, but host
journal accounting currently measures before capture: that ordering still
needs correction and budget tests before qualification. Pending-property
reconciliation, descriptor changes, shared aliases, failure cleanup, and
callable properties remain to verify. Candidate source is not integrated.

The journal accounting regression failed concretely (59e641): it charged 298
units while the post-capture retained graph measured 561. Moving its single
measurement after the outcome copy/capture fixes this ordering without adding
a second whole-graph traversal. All 22 selected tests pass (e70bd1), including
the new pending checkpoint control: original properties and self-alias survive
proof replacement, completed replay requests no second proof, and the host
loader runs once.

An additional data-budget rejection/unchanged-journal control and maintained
pending checkpoint, nested proof, and validation cases are running in session
79574, report `/tmp/safejs-host-promise-properties-pending-budget.json`.
Scoped candidate lint followed by TypeScript is session 58572. Keep candidate
source fixed while these qualifiers run. New-host property code remains
isolated; main input property support is now committed as 61fe74f35.

The six-file pending/budget selection passed all seventeen tests (3cb064),
including rejection when only the uncaptured graph would fit and restoration
of the journal's prior accounting/lifecycle after rejection. Lint/TypeScript
session 58572 remains live. This does not yet qualify callable property
capabilities or all malformed property graphs.

Candidate lint and TypeScript passed (522e96). A public callable property
using an explicitly supplied input function capability also passes, including
completed replay without repeating the loader or function. Three malformed
pending property-reference controls pass without provider invocation. The
first allocation-rollback fixture omitted required array `nullPrototype`
metadata and failed before reaching the intended allocation boundary (3afec7);
that fixture was corrected without changing runtime. A five-file refreshed
selection is running. Fresh host-created functions without a resume capability
are not claimed to be replayable by the explicit-capability control.

All twelve tests in the refreshed five-file selection passed (70b53f).
The complete candidate snapshot directory plus six host/property/journal
files is now being qualified, report
`/tmp/safejs-host-promise-properties-broad-candidate.json`. Source remains
isolated and must stay fixed during that run. The two latest test files also
have a fresh scoped lint run; earlier runtime lint/TypeScript remain green.

The two latest test files passed scoped lint (2f552a). Broader candidate
snapshot session 22226 remains live; its final totals are still outstanding.

## Main integration

Current main c271c1a5a independently reproduced all five public property replay
failures (40814a), report `/tmp/safejs-host-promise-properties-main-red.json`.
After reviewing the four-file runtime diff, the tested candidate was copied
to main alongside its five regression files. This does not change isolated
session 22226's source. Main's ten-file focused selection is session 42223,
report `/tmp/safejs-host-promise-properties-main-focused.json`; scoped lint is
70005 and the maintained SafeJS build closure is 41822. Keep main runtime and
tests fixed while those qualifiers run. No feature commit, push or release is
claimed yet. README describes data replay and the explicit callable-capability
boundary rather than claiming arbitrary host function serialization.

Main focused qualification passed all 43 tests across ten files (6e3647).
Scoped lint passed (decdd1), and the maintained build passed all 23 builds and
five fresh-process imports (09d4da). The isolated broad snapshot run remains
live and has emitted a failure marker; its final attribution is not available.
Read-only review found an older `does not discard custom Promise properties`
test whose assertion requires rejecting every property-bearing imported
Promise. Main is checking that unchanged file separately before deciding
whether this is the expected contract update or a distinct regression.

The isolated broad run is terminal: 2,327 passed and one failed across 172
files (61bfd8). The only failure is exactly the older blanket-rejection
expectation. Main independently confirms that failure with nineteen controls
passing (1be1b7). The test's no-data-loss purpose is retained by replacing the
rejection assertion with a round trip that requires both `extra === 1` and
settlement value seven. No runtime guard or malformed-data assertion was
removed to accommodate it. Main focused checks and scoped test lint are being
refreshed, followed by broader main snapshot qualification.

The refreshed focused run is session 76518, test lint is 20996, and the main
snapshot-directory plus six host/property/journal files is now running with
report `/tmp/safejs-host-promise-properties-main-snapshot.json`. Keep main
runtime and test sources fixed until all three runs finish. The earlier
build/runtime lint results still cover the unchanged runtime implementation.

The refreshed main focused run passed all 31 tests (e31155), and updated
test lint passed (7f9575). Main snapshot session 3195 remains live.

## Additional alias boundary blocks feature completion

Four isolated public controls for aliases between host-return Promise
properties and the surrounding outcome pass for synchronous/asynchronous
loaders and both property orders (9e845d). Extending the same expectation to
an imported input Promise settlement fails for both orders (3af1e1): the very
first execution returns `[false, 0]` rather than `[true, 1]`, before a replay
generation even starts. This is not merely a stale rejection expectation.
The six-case regression is isolated at
`src/run.host-promise-property-aliases.test.ts`, report
`/tmp/safejs-promise-property-alias-boundaries.json`.

Do not commit the integrated feature as complete based on the currently
running snapshot gate. Investigate original settlement/property capture and
the input-await journal copying boundary while main source remains fixed.
Shared identity must survive without discarding original-data isolation.

The input bridge recopy explains the first-execution split: ordinary settlement
objects are copied again, but an already-sandboxed nested Promise was returned
unchanged with its previous property graph. An isolated host-bridge repair
preserves explicitly prepared Promise replacements and otherwise copies newly
encountered imported wrappers and their descriptors into the same recopy
identity graph. All sixteen tests in the alias/public-host/pending selection
pass (711a5b), including both previously failing input property orders through
two replay generations. This is a new runtime change, not covered by earlier
snapshot/build results.

A broader eleven-file alias/identity/scheduling/cancellation selection is now
running, report `/tmp/safejs-input-promise-property-alias-qualification.json`,
with scoped lint followed by TypeScript separately. Main remains unchanged
while snapshot session 3195 runs; this latest alias correction is still isolated.

The eleven-file alias qualification exposed two regressions with 58 passes
(2c92e4): a shared pending Promise was copied separately across input outcomes,
and consuming an original wrapper's native promise failed to mark that wrapper
observed for rejection tracking. Candidate lint/TypeScript passed (315237),
but do not establish correctness of that version. The isolated bridge now
records each new copy in the shared input replacement map and explicitly
observes the wrapper whose settlement it consumes. The unchanged eleven-file
selection is rerunning, report
`/tmp/safejs-input-promise-property-alias-corrected.json`. No assertions were
weakened; both maintained failing cases must pass before integration.

The corrected eleven-file selection passed all sixty tests (1ed1c5), report
`/tmp/safejs-input-promise-property-alias-corrected.json`. This includes both
maintained regressions from the first alias candidate. The corrected bridge's
lint/TypeScript is session 62424; main snapshot session 3195 remains live.
Neither live check is counted as a pass, and the alias bridge/test have not
yet been copied to main. The main pending feature remains uncommitted.

Main snapshot qualification is now terminal: all 2,328 tests across 172 files
passed (520c6d), report `/tmp/safejs-host-promise-properties-main-snapshot.json`.
This result predates the input alias correction and cannot qualify it. The
six-case alias regression has now been added to main for independent TDD;
main runtime is still unchanged for that baseline. Candidate bridge lint/
TypeScript session 62424 is still being collected.

Main alias TDD reproduced two failures with four passing controls (f05259),
report `/tmp/safejs-input-promise-alias-main-red.json`. The corrected isolated
bridge lint/TypeScript passed (fd1b5a). Its reviewed bridge-only diff is now
integrated on main; an expanded fourteen-file alias/property/budget/identity
selection is running with report `/tmp/safejs-input-promise-alias-main-green.json`.
Main scoped bridge/test lint followed by the maintained build closure is also
running. The previous 2,328-test main snapshot result predates this bridge
correction. No commit or delivery claim is made yet.

The fourteen-file main selection passed all seventy tests (a9be3a), report
`/tmp/safejs-input-promise-alias-main-green.json`. Scoped bridge/test lint
passed, as session 36727 has proceeded to the maintained build closure; its
terminal build result is outstanding. Main runtime and tests remain fixed.

The maintained build passed all 23 builds and five fresh native ESM checks
(b2022c). The host-data/alias feature is ready for its atomic local commit,
with the earlier snapshot qualification and latest seventy-case bridge checks
reported separately. A new isolated six-case property-name budget probe found
two independent failures (c46898): Promise key length 129 bypasses limit 128
on import and replay; ordinary-object and at-limit controls pass. See
`safejs-promise-property-key-budgets.md`. This commit does not claim that gap,
the full package, or the overall JavaScript-completeness goal is resolved.
