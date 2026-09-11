# Native Promise aliases across settlement

## Scope and evidence

This is separate from native Promise own-property admission. Do not import
host metadata or alter the pending admission-policy choice.

A read-only probe shows settlement data referring back to the original host
Promise imports a distinct sandbox wrapper (4a598d). Sibling Promise references
are likewise re-imported. Native Promise settlement callbacks currently start
with a new seen map, losing already admitted Promise identities.

Ordinary objects shared across distinct settlements also copy separately.
Do not change that data-copy boundary merely to match native live-object
identity; investigate Promise identity independently.

## Isolated reproduction

Candidate `/tmp/safejs-promise-settlement-alias.M2yEN3` is copied from main
runtime f535553f4. Main remains fixed for full integration session 65053.
The self-reference test removes the host back-reference after the first
settlement so the unfixed re-import chain cannot continue indefinitely.

Initial deep property assertions passed despite the demonstrated identity
mismatch (ee228d). They were corrected to strict identity assertions; do not
count deep structural equality as evidence that Promise aliases are preserved.
Strict regressions are running before any implementation change.
Both strict identity regressions failed (acd461). The isolated candidate now
shares a native-Promise identity map through settlement copies while each
settlement still receives its own ordinary-value seen map. Focused alias,
foreign-Promise and value-copy tests have been started. No main code changed.
That initial selection passed all 31 tests across three files (64646d).
Rejection, mutual cycles, independent imports and ordinary-value copy controls
remain required before qualification.

Expanded controls cover rejection reasons referencing a sibling Promise,
mutual fulfillment references, independent import operations, separate ordinary
settlement copies with late host mutation, and foreign native Promises whose
own getters/symbol metadata remain excluded. The initial foreign fixture also
contained a foreign Array and hit the existing container admission restriction;
it now uses host-owned containers to isolate Promise behavior.

The expanded Promise/value/public-alias/ordering/compatibility/structured-clone
selection passed 117 tests across seven files (2a5d8a). Earlier targeted lint
and TypeScript completed successfully (81de5e); refresh checks after final
fixture changes. The public probe failed (60f6cd): `run()` still returns false
for a settlement's sibling Promise identity, and completed replay rejects the
host result as live execution state without an explicit resume capability.
The direct-copy candidate is therefore insufficient and must not be integrated
as a public API fix. Replay input preparation replaces admitted Promises with
host-operation wrappers; settlement references require investigation at that
second identity boundary as well.

An isolated public regression now covers bindings, entry-point arguments,
module imports and import.meta. All four execute successfully but return false
for strict sibling identity (47416b), even with the direct-copy candidate.
The test is `src/run.promise-settlement-identity.test.ts` in the candidate.
This expands the required repair beyond the direct value-copy helper; keep
main unchanged until public identity and replay behavior are qualified.

The second boundary is independently reproduced without native Promise import:
`snapshot/replay-input-settlement-identity.test.ts` constructs already-sandboxed
Promises and supplies the wrapper callback to `prepareReplayInputs`. The strict
settlement identity assertion fails (440b72). This isolates replay input
replacement from host copying.

Code inspection also found a separate native import implementation in
`interp/host-bridge.ts`: `copyHostValueToSandbox` starts each fulfillment with
a fresh seen map, independently of `values.ts`. Binding/module input repair
must cover that path, not just `deepCopyToSandbox`.

Host-call result encoding in `interp/host-call.ts` currently supplies closure
capability identification/resolution, but not Promise identification/resolution.
That explains the observed completed-replay rejection and means wrapper
reconnection alone is insufficient. Any repair must preserve explicit replay
capability validation and avoid admitting arbitrary live host execution state.

## Host-bridge candidate

Two strict bridge-level regressions first failed (1e6e08): sibling identity
and a fulfillment back-reference. The isolated `host-bridge.ts` now retains
a Promise-only identity map across fulfillment copies while keeping ordinary
seen maps separate. Error-data and own-property policies remain unchanged.
The first bridge/direct-copy/public-alias selection passed 27 tests (5c36c5).

Added independent-import, ordinary-data late-mutation/copy and excluded metadata
controls. The expanded five-file selection passed 88 tests (05a7ee), including
Promise ordering and compatibility. Candidate TypeScript passed (730f4f).
This verifies the host-copy layer only; the public/replay regressions remain
unfixed, and no candidate runtime source has been copied to main.

## Public input wrapper candidate

The candidate now keeps an input-operation-scoped map from imported sandbox
Promises to their prepared wrappers. `copyHostValueToSandbox` consults that
map for already-sandboxed Promise values in input-operation results. Ordinary
host inputs do not receive this replacement map.

All four public input routes now preserve the sibling identity; the new public
regressions plus existing public alias coverage passed 23 tests (6f2cf6).
The earlier isolated `prepareReplayInputs` regression is a boundary diagnostic,
not evidence that its caller-provided wrapper callback can repair references
without cooperating with result conversion.

Added a completed-replay regression. It fails specifically at `dump()` because
the recorded outcome lacks Promise capability encoding (78fd89); the four
first-execution route cases remain green. Do not claim replay qualification.
Host-call replay already supports waiting for unresolved closure capabilities;
investigate explicit declared input-Promise identities using the same deferred
reconstruction mechanism, with validation against actual input operations.
Do not accept arbitrary Promise identifiers or silently bypass journal checks.

## Journal capability candidate

The isolated journal now registers prepared input Promises by their recorded
input-call identity, includes only registered references in outcome encoding,
and waits for wrapper reconstruction during outcome decoding. Restore-time
journal decoding recognizes declarations only for asynchronous read-side-effect
input operations; ordinary unregistered Promise results remain inadmissible.
Retained-value accounting includes registered input Promises and disposal clears
the registry. Initial completed replay and four first-run routes passed (07edad);
TypeScript passed (e5118b).

Expanded repeated replay and self-reference tests pass without supplying original
host inputs. A four-file selection had 55 passes and one assertion failure
(5e1366): the invalid-reference test assumed `restore()` itself eagerly validates
the journal, but it accepted the container. The test now checks the subsequent
`run()` rejection explicitly; this validation boundary is not yet qualified.
The next run confirmed that the undeclared identity throws from journal
construction before execution (5cb2cb); it is not a returned guest error result.
The regression now asserts that rejected `run()` Promise and its exact missing
capability message. Other ordering/compatibility cases passed (65 passes).
The corrected seven-case public selection passed (188dd3).

Mutual fulfillment references passed in the next expansion, but a Map-key/Set-
entry settlement regression failed with a non-function error (e9d71c). Inspection
showed `copyHostValueToSandbox` recognized native Map/Set only, so its second
conversion treated already-sandboxed collections as ordinary records. The
candidate now accepts branded sandbox Map/Set in the existing recursive
collection-copy branches. Collection budget charging and input Promise remapping
remain on those branches. This additional conversion gap requires its own
qualification and atomic delivery decision before integration.
The expanded public and existing alias selection passed 28 tests (bfce27), and
candidate TypeScript passed (af7378).

Fixed-source candidate qualification started as session 18929: snapshot tests,
public Promise aliases/ordering/compatibility/new settlement cases, host-call
tests and both new copy-layer selections. JSON output is
`/tmp/safejs-promise-settlement-candidate-results.json`. The deliberately failing
isolated `replay-input-settlement-identity.test.ts` boundary diagnostic is
explicitly excluded; production wrapper/result-conversion behavior is covered
by the public regressions. Candidate lint session 24609 is also running.
Do not edit candidate runtime/tests until these checks terminate.
Candidate lint passed (869da9). The main baseline independently reproduced the
Map/Set failure (2d5c93), with a separate RegExp settlement admission gap recorded
in `safejs-host-promise-settlement-builtins.md`. Candidate and main test sessions
were both confirmed live during this audit; neither has a terminal result yet.

Candidate session 18929 subsequently terminated successfully (8baf32): 2,363
tests passed across 167 files, with the diagnostic exclusion described above.
The main full gate also terminated separately and is recorded in its own plan.
The Map/Set second-conversion repair is now being integrated independently;
main tests first reproduced all three collection failures (364d54). Do not
transfer the candidate's whole host-bridge file over that atomic repair.

## Main integration

Main now includes the independent collection repair `39b20fd30`. The four
non-cyclic public sibling identity regressions were reproduced before applying
the alias repair: all four failed strict identity (e6a688); the five other public
cases were intentionally unselected in that red run, not counted as passes.

Transferred only reviewed remaining diffs for values, host bridge, host-call
journal and run wiring, preserving the committed collection repair. Added the
three candidate regression files, not the earlier isolated wrapper diagnostic.
Main focused tests (48379), TypeScript (20377), and lint (86745) are running.
README documents already-imported Promise references without claiming arbitrary
live Promise result serialization or host metadata admission.
The main eight-file selection passed all 117 tests (0c12c9), and TypeScript
passed (d28a42). Byte comparison confirmed all four runtime files exactly match
the candidate qualified by the 2,363-test selection (0094fa). Main lint and the
maintained selected-workspace build (83618) remain pending. Diff whitespace
validation passed. Unrelated staged safe-bash files remain untouched.
Main lint passed (bfc985), and the maintained workspace build completed 23
declared build tasks plus five built-import checks (0fc478). These checks and
the fixed-source candidate suite qualify the local alias repair. A new full
main integration run is still required after committing; the previous full
run predates both this repair and collection conversion. No push or release.

## Intended boundary

Preserve already admitted native Promise identities within one imported graph
and its settlements, while keeping ordinary settlement data copied separately
and own properties excluded. Independent import operations must remain
independent. Verify fulfillment, rejection, mutual references, foreign realms,
and metadata exclusion before integration. No push or release during the hold.
