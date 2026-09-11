# Native Promise string-property admission

## Validated gap

During main's pending-Promise full gate (session 41633), source inspection
confirmed that native Promise import creates an empty guest property table.
All three initial regressions fail against the matching isolated source
(f13f1e): own descriptor data is lost, own accessors are silently discarded,
and nonextensibility is lost. The candidate is isolated at
`/tmp/safejs-new-promise-capability.KGfWqD`; main remains fixed for its full gate.

## Candidate and evidence

The candidate copies own string data descriptors through the normal sandbox
copy graph, preserving shared references and self-cycles, and preserves table
nonextensibility. It does not copy host symbols. Existing symbol admission
remains unresolved; distinguishing user keys from private async-hook metadata
is required before importing those symbols safely.

The initial candidate passed 92 tests in values, Promise, public pending replay,
and its new regression file (0ffc2d). Stronger accessor controls then reproduced
two failures (fae713): importing `then` or `constructor` accessors invoked host
getters before the eventual property validation. The candidate now captures and
validates descriptors before native Promise machinery runs. The refreshed
selection passed all 94 tests (265a0b). Tests cover descriptor flags, hidden
data, cycles, aliases, host round-trips, nonextensibility, and rejection of
label/then/constructor accessors without invocation.

Scoped lint followed by candidate TypeScript is session 40754; collect its
terminal result. These focused checks do not prove complete property admission.
Next cover own `then` and `constructor` data shadows, inherited Promise hooks,
public guest reads, quota enforcement and snapshot implications. In particular,
the native `Promise.resolve(value).then(...)` observer still depends on those
public properties; the current candidate has not qualified shadowed data keys.
Do not transfer it to main or claim that all native Promise metadata is supported
until those boundaries are resolved. No commit, push or release yet.

## Shadowing and public-path follow-up

The earlier lint/TypeScript command passed (38fc1b); it predates the changes
below. Three own `then` data shadows (0, undefined, null) failed (386be4),
while two constructor data shadows passed. Observing native Promises via
`Reflect.apply(Promise.prototype.then, value, callbacks)` repairs those cases.
The refreshed five-file selection passed 104 tests (d70068).

A new public guest-read test then failed (201fe9): the internal copy result
does not establish that run bindings retain Promise properties. The candidate
now shares descriptor validation in `interp/native-promise-properties.ts`
between values.ts and the host bridge. The bridge copies native Promise own
string data, preserving nonextensibility, before exposing its wrapper. It
uses an intrinsic observer for native Promises while preserving the existing
ordinary-thenable route. This observer adds a native reaction and needs broad
scheduling/cancellation compatibility checks before integration.

The public test still fails after that bridge change: 22 passes, one failure
(b9cfa6). Read-only tracing identifies another concrete loss point:
`prepareReplayInputs` encodes each Promise as a bare `promise-capability` atom,
and run's `prepareInputPromise` returns a new journaled wrapper without the
property graph. Copying properties only onto that temporary wrapper would not
preserve persisted state and is not a sufficient fix. Next extend the replay
input representation with property-bearing Promise capabilities, retaining
aliases/cycles and descriptor state across original execution and dump/restore.
Use the existing function capability graph pattern as a reference, preserving
backward compatibility for bare Promise-capability atoms. Add malformed-graph,
budget and rollback controls before integrating that format change.

Main full gate 41633 is still running; no candidate edits have been copied to
main. Current candidate modifications additionally include host-bridge.ts and
the new helper/test; earlier passing lint/types do not qualify this state.
Inherited constructor/species hooks and user-symbol policy are still open.

## Property-bearing replay capability candidate

A graph round-trip regression failed before the format change (ac7c5e), while
the old bare atom control passed. The candidate now emits a property-bearing
`promise-capability` node only when capability-property capture is enabled and
the Promise has own properties or is nonextensible. Plain capability atoms stay
compatible. Nodes capture property tables as shared graph objects, preserving
aliases, self-cycles and descriptors. Decoder initialization replaces the
resolved wrapper's property table, with rollback restoring the previous table
on failure. `promiseProperties` is now an internal exported WeakMap so decoding
can replace the table without mutating an externally shared old table.

Validation-only replay input Promises are now fresh, untracked wrappers rather
than one module-global Promise whose table would be shared across validations.
Initial guest execution and the graph test passed in a 26-test selection
(bdbd1b). Completed public replay without the original input also passed.

A hostile graph substituting the Promise itself for its property table was
incorrectly accepted (d69cd1). The decoder now requires an ordinary-object
graph node for the table before resolving the capability. A late initialization
failure control additionally proves rollback retains the original table and
its current data. All 28 tests across the public import, graph and existing
replay-input files now pass (003e07).

Current scoped lint followed by TypeScript is session 70780. A nineteen-file
compatibility selection is running as session 38346 (0b7813); its JSON report target is
`/tmp/safejs-promise-properties-candidate-results.json`. Poll that handle;
do not treat this plan alone as evidence that the process remains live.
Candidate source must stay fixed for these checks. Nested callable property
capability paths, budgets, duplicate capability nodes, inherited native hooks,
and the user-symbol policy still need qualification. Main remains unchanged
and its full package gate remains session 41633.

The current candidate's scoped lint and TypeScript command passed (6a7866).
Read-only inspection confirms `readCapability` has a special property-table
path for closures, but not yet Promises. A nested callable property restoration
test is therefore required next; source inspection alone is not a new failing
regression and does not justify claiming that boundary is fixed.

## Callable property qualification

The nineteen-file candidate run completed with 124 passes (83b6d1). The next
low-level callable-property restoration regression failed with a missing
`["bindings","input","properties","read"]` capability (51c9b2). The replay
input path reader now traverses Promise property tables as it already does
closure property tables. That regression subsequently passed.

A public two-callable-property test then failed before guest execution because
both functions registered the same `host:["<bindings>","input"]` identity
(f638b4). The candidate host copier now appends the property key to its
capability path, using the existing nested-property convention. The public test
requires original execution to return distinct values and completed replay
to use recorded outcomes with replacement host functions supplied; it does not
equate replay with rerunning the replacement functions.

The refreshed four-file test selection passed all 51 tests (5434a9). Scoped lint
followed by TypeScript is session 9105 (6a4560). Main full
gate 41633 remains live, and no candidate source has been integrated or committed.

The callable-path candidate's lint/TypeScript checks passed (c18c1a). Subsequent
property budget controls found an independent shared replay decoder gap; see
`safejs-replay-input-allocation-budgets.md`. The isolated candidate now also
contains that two-check repair. Its 54-test selection passes (3ba0d0), but the
earlier nineteen-file/124-test result predates this latest decoder change.

Foreign-Promise compatibility qualification found a candidate regression:
three maintained foreign import tests pass, but importing a foreign Promise
with an unrelated label getter now throws (e5a1fc). Main deliberately accepts
that value without invoking/copying the getter. The new own-data property
feature must preserve this established behavior; do not rewrite that maintained
test to require rejection merely to qualify the candidate. Native constructor/
species getter observations were also reclassified after checking the language
algorithm and existing host contract; see safejs-native-promise-observation-hooks.md.
No new blanket hook guard is justified by those observations alone.

The isolated own-data helper now omits accessor descriptors rather than
rejecting their containing native Promise, restoring the established foreign
Promise contract. The new unit assertions for label/then accessor metadata
require omission without invocation. The earlier invented constructor-accessor
rejection assertion was removed; native observation hooks are not thereby
claimed to be unobservable. Accessor transport remains outside this own-data
feature and must not be counted as implemented JavaScript accessor admission.
A four-file selection including the unchanged foreign-Promise tests is session
9809. This change postdates the isolated 2,294-test snapshot result and needs
fresh qualification; it is still not integrated on main.

The four-file compatibility selection passed all 27 tests (2fb818), including
the unchanged foreign-Promise accessor case that previously failed. Alias,
settlement/rejection and prototype-forgery controls also pass. Scoped helper/
test lint and TypeScript are being refreshed after this policy correction.
The shared-decoder repair has independently moved to main and passed 50
selected tests plus lint; the property feature remains isolated.

The corrected helper/test scoped lint and candidate TypeScript checks passed
(79b934). Main's broader allocation-repair snapshot check is session 45437;
its result must be collected before committing that independent repair.

The independent replay allocation repair is now local commit d9bb0730d after
all 2,291 main snapshot/allocation tests passed. It was not pushed or released.
The property candidate remains isolated. A fresh fourteen-test own-string
selection passed (b71845), including three public native-await differential
controls for own `then` and `constructor` data shadows, each also checking
completed replay. Its JSON is `/tmp/safejs-promise-shadow-controls-results.json`.
This does not resolve own-symbol metadata or accessor transport. A refreshed
sixteen-file import/replay/cancellation/budget selection is being run against
the corrected candidate, report
`/tmp/safejs-promise-properties-refreshed-results.json`.

The refreshed selection is terminal: all 128 tests across sixteen files passed
(386e20). This includes the corrected foreign-accessor admission contract,
public await-shadow controls, capability properties, replay inputs, settlement
identity, cancellation, and allocation limits. Main integration still requires
reviewing the candidate diff against d9bb0730d and main-scope qualification;
these isolated passes alone do not constitute a delivered feature.

## Main integration

The candidate diff was reviewed against d9bb0730d. Main TDD reproduced seventeen
failures with four controls passing across the new own-string and capability
graph files (bdceb4, `/tmp/safejs-promise-properties-main-red.json`). Failures
include omitted descriptors/callables and broken native `then` shadows, not
merely missing new graph-node support. The five intended runtime files and
three regressions were then integrated without unrelated changes. Main scoped
lint and a seven-file import/replay/allocation/cancellation selection are
running; no commit or remote delivery is claimed for this feature yet.

The main seven-file selection passed all 52 tests (0114d5), report
`/tmp/safejs-promise-properties-main-green.json`. The maintained SafeJS build
closure is session 91131; scoped lint is session 89875. The snapshot directory
plus additional import/replay compatibility files is now running with report
`/tmp/safejs-promise-properties-main-snapshot.json`. Keep runtime and test
sources fixed until these qualifiers finish. README now describes own-string
data support and explicitly retains the accessor/symbol and native-hook caveats.

Scoped lint passed (00b2f9). The broader main snapshot/compatibility run is
session 28575. Build session 91131 has reached the SafeJS TypeScript stage but
has not yet returned a terminal result; neither live run is counted as a pass.

The maintained build is now terminal and passed all 23 builds and five fresh
native ESM checks (2453fa). Main snapshot session 28575 remains live.
A separate isolated public regression found that own data on newly encountered
host-return Promises prevents replay dumps; see
`safejs-new-host-promise-data-properties.md`. Input capability property support
must not be described as fixing that separate host-outcome path.

Main snapshot/compatibility qualification passed all 2,380 tests across 176
files (dc18dc), report `/tmp/safejs-promise-properties-main-snapshot.json`.
Together with main TDD, 52 focused passes, lint, and the maintained build,
this qualifies the own-string/input-capability implementation for its own
local commit. New host-outcome property recording remains a separate isolated
repair; the full package is not yet green. No push or release is performed.
