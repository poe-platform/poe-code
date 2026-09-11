# Portable intrinsic mutations

## Validated evidence

The current runtime executes added methods on BigInt, Number, String, RegExp,
and Object prototypes, and added data on the BigInt constructor. Dumping these
runs rejects them with "Guest function properties and prototype links cannot be
serialized." Pending and completed checkpoints fail. Prototype aliases and
accessor additions fail too.

A distinct runtime gap precedes snapshots: assigning `Number.isNaN.extra = 3`
fails with "Assignment expressions require a sandbox object property." Native
JavaScript permits it. Keep this failure separate from the checkpoint diagnosis.

## Current boundaries

- `interp/object-model.ts` registers selected intrinsic constructors and their
  prototype records. `hasGuestObjectState` reports changed intrinsic state.
- `snapshot/dump-format.ts` rejects that state before serializing a heap node.
  Its heap discovery normally traverses enumerable data, not complete function
  descriptors or guest prototype links.
- `snapshot/serialize.ts` and `snapshot/replay-data.ts` also reject guest object
  state; simply relaxing the public dump guard is insufficient.
- Current run replay reconstructs fresh builtins from source plus initial inputs
  and effect journals. Low-level restoration and migration have separate graph
  contracts. Passing replay alone would not prove faithful state serialization.
- Guest callable properties and opaque host/live capabilities have different
  authority. Do not turn a serialized function name into arbitrary host access.

## Required design and verification

1. Define stable, realm-owned identities for intrinsic constructors, prototypes,
   and method functions. Preserve aliases without copying host implementations.
2. Encode guest-visible descriptor/prototype mutations as graph data, including
   additions, deletion, symbols, accessor closures, extensibility, and cycles.
   Traverse descriptors without invoking getters or other guest code.
3. Keep guest AST-backed callable references distinct from intrinsic references
   and externally resolved capabilities. Reject forged or unavailable references.
4. Restore against the correct fresh realm with validated graph references and
   resource accounting. Cover both replay checkpoints and low-level graph paths;
   explicitly test migration compatibility rather than assuming it.
5. Retain and validate complete observable state. Do not bypass rejection by
   discarding mutations, serializing only function names, or omitting bindings.
6. Audit builtin static-function mutability as a separate prerequisite. Extend
   registration deliberately; do not globally relax live-capability boundaries.

The original local regression matrix was intentionally red while this design was
implemented. Its sixteen public dump/replay cases now pass; this does not prove
low-level graph restoration or migration. Do not commit/push unfinished integration
as a completed fix. Add adversarial tests
for aliases, cycles, deleted properties, accessors, unknown intrinsic IDs, resource
limits, and effect replay before delivery. Each completed atomic improvement gets
its own commit and direct push to main; releases remain independently monitored.

## Implementation progress

- Number's four predicate methods now use guest function objects. Twenty native
  comparison cases first failed, then passed for assignment, descriptors,
  accessors, symbol keys, and extensibility. Each native case runs in a fresh VM
  realm to avoid mutating Node's shared builtins.
- Intrinsic baseline tracking now includes guest static methods as well as
  prototype methods, and detects extensibility changes. Three direct regressions
  first failed and now pass for additions, deletions, and preventExtensions.
- The runtime prerequisite is implemented. Public graph serialization is now
  connected below; low-level restoration and migration remain unfinished. No
  serializer guard has been bypassed by omitting mutated state.
- The first full suite exposed a retained-root accounting regression (555 units
  against an unchanged 500-unit limit). Builtin method metadata is now identified
  as intrinsic, like constructor metadata; guest replacements remain charged by
  the intrinsic retained-value provider. The existing accounting tests pass
  without changing their limits. Additional checks cover replacement metadata
  retention and unchanged host-capability mutability boundaries.
- Realm identity registration now covers the installed Object, Number, String,
  Boolean, BigInt and RegExp constructors/prototypes and their direct methods and
  accessor closures, including well-known-symbol installation sites. Resolution
  uses the fresh realm's registry, not arbitrary function names. Captured identity
  survives close for completed dumps; realm resolution is released on close.
- The descriptor codec preserves complete own descriptors, accessor closure
  references, symbol keys, extensibility and insertion order. It decodes and
  preflights compatibility on a descriptor-only trial object before modifying
  the destination. Graph allocation and prototype links belong to the caller.

## Next integration boundary

Interpreted ordinary and generator closures now have trusted origin metadata in a
weak registry: AST node, captured scope and function environment. `captureFrame()`
preserves each lexical frame, parent identity, shared binding-cell IDs, TDZ state,
import metadata, function/charging boundaries and pending restored bindings. It
does not expose the interpreter's mutable binding records. Tests cover shared
captures versus separate invocations of the same AST, named self bindings, lexical
`this`, and method home objects.

Connect this metadata to heap discovery, serializers, validation and fresh-realm
restoration. Allocate scope/function identities before hydrating their references
so recursive closures and shared environments survive. Validate parent links and
cell indexes before hydration. The older `Scope.snapshot()` remains a flattened
view for existing replay paths; do not use it as the portable lexical-frame graph.
Class-construction environment callbacks are not portable data and must not be
silently omitted or treated as ordinary guest function origins. Do not infer that
encoding a closure's name/source range preserves its captured environment.

Trusted installation-site registration now traverses the complete object-valued
graph returned by `createBuiltinBindings`, including JSON, Math and console.
Traversal uses public function property records, not host implementation fields,
and never invokes guest getters. A regression confirms a resolved console method
uses the fresh realm's sink rather than retaining the previous one. External
caller bindings still require explicit capability identities rather than this
trusted builtin path.

`snapshot/guest-heap.ts` combines intrinsic identities, property descriptors,
closure origins and lexical frames into typed heap-node records. Its encoder
callback is now supplied by the public graph serializer after allocating a
reference, allowing cycles. Heap discovery traverses descriptor values and
captured frames, forces referenced guest objects into heap records, and checks
graph depth. The actual public dump regression verifies that all emitted refs
resolve. The new format is version 2; validation continues accepting legacy
version-one envelopes and requires version 2 for guest heap records.

Public validation checks descriptor flags, callable accessor refs, known canonical
intrinsic IDs, binding-cell indexes and aliases, scope-parent cycles, and source
AST function identities. Sixteen pending/completed intrinsic-mutation cases now
pass public dump/validation/replay. This uses the existing source replay mechanism;
it does not yet prove that low-level restoration can hydrate these records. Finish
that path, capability identities, full compatibility checks and migration before
claiming portable intrinsic-state restoration.

## Public integration verification

The first full suite after public version-two wiring reports 15,065 passes and
91 failures (25 files). Many failures explicitly expect version 1, inline closure
or generator records, or the former rejection of function/accessor state. They
must be inspected individually before updating expectations. Generator checkpoint
selectors currently fail to locate their chosen records; do not merely change
selectors without checking captured generator state and cross-root aliases.
The new intrinsic mutation matrix, actual-dump reference check, malformed guest
heap checks and source-AST validation pass. Lint and type checking pass.

Outstanding integration includes low-level hydration, migration and compatibility
fixtures, capability-bearing captured scopes, and specialized runtime values
reachable through those scopes. Source replay success alone is not evidence that
the serialized graph can independently restore those values.

Generator follow-up validated a capture gap: ordinary object encoding did not
include the channel history or trusted origin. Dedicated `guest-generator` records
now include AST identity, async/state flags, closure and execution scopes, the
actual lexical scope at suspension, yield identity and sent completion history.
Public validation checks generator origins and ownership of yield IDs against the
source AST. Tests verify aliases, a TDZ local at suspension, async suspension,
start/done generators, and forged completion/origin/yield rejection. After that
evidence, crash/resume selectors were updated to dereference heap records; all
eleven crash/resume tests and seven new generator checks pass together.

Before low-level hydration, distinguish internal scope references from ordinary
guest-data references in validation; scopes must only be consumed in the specific
metadata fields that require them. Scope allocation/hydration must preserve shared
cells without exposing internal Scope objects as guest values. Generator capture
is not yet proof that low-level continuation restoration reproduces its effects.

Scope restoration groundwork now passes its focused checks. Public reference
validation permits internal scope refs only in actual heap-node metadata fields,
not guest bindings, cells, descriptors or nested values; five forged-input tests
first passed incorrectly and now reject, including a shared reference object used
in both roles. `Scope.hydrateFrame()` preserves aliases, TDZ cells, metadata and
pending restored bindings, rejects invalid cell indexes before modifying bindings,
and refuses to overwrite an existing or already-hydrated scope.

`snapshot/scope-frames.ts` allocates parent scopes before any guest-value decoding,
then hydrates values through the enclosing graph decoder. Tests cover out-of-order
parents, recursive closure captures, shared values, cycles, missing parents,
depth limits and work metering. These helpers are not yet wired into the full
low-level restorer. Latest full suite: 15,090 passed, the same 88 integration/
compatibility failures; lint and type checking pass.

## Low-level graph hydration progress

The independent closure regression first failed because `serialize()` traversed
the host `.call` implementation. Low-level serialization now captures guest heap
records, shared lexical-frame references and descriptor edges. The low-level
validator checks these records, their function AST origins and scope-reference
roles. Restoration allocates scopes before hydration and uses the normal
interpreter closure factory, with deferred object/descriptor population for cycles.
Intrinsic rebuilding uses the active compile owner; the expanded tests exposed
and verified that ownership fix.

Seven direct serialization/restoration checks pass, including shared captured
cells isolated from the original execution, async/default parameters, recursive
functions, object methods, accessors and mutated intrinsic properties. The initial
three-file serializer/restorer run passed all 99 checks before adding the five
expanded cases. Wider snapshot coverage reports 530 passes and 18 failures in
backend, scheduler and OBJ002 format/compatibility expectations; these still need
individual reconciliation, not blanket fixture rewrites.

This remains uncommitted integration work. Low-level `guest-generator` hydration
now supports the directly tested start, suspended and completed cases below.
Capability restoration, generator effects, complete malformed-input/AST checks,
migration and the full package gate remain required before delivery. Existing
legacy low-level generator records retain their restoration path.

## Generator hydration progress

Eight low-level generator regressions now pass: start/suspended/done state with
shared effect cells isolated from the original execution; nested lexical shadowing;
return through finally; throw through catch; async sent values; and avoiding a
repeated side effect in the evaluated prefix of a sequence expression.

The suspended-variable-initializer regression first skipped a later yield because
cloned contexts retained stale resume state. A shared completion marker now ends
replay across those copies. The nested-block regression first returned the inner
shadowed value after leaving its block. Generator heap records now retain active
block AST-to-scope references, and resumption selects each block's captured scope.
Completion tests also reserialize restored generators and verify sent history.

The four-file focused run passes all 104 tests. A full maintained package run
finished with 15,099 passes, 94 failures and 41 skips; it loaded the expression
regression before its fix. Compared with the prior full run, the other five added
failures are function-properties tests expecting low-level serialization to reject
state it now captures. Replace those assertions only after checking independent
restoration of their exact descriptors/prototypes. The original 88 integration and
compatibility failures remain outstanding. No commit or push yet.

Do not infer general continuation completeness from this matrix: validate loops,
delegated yields, intermediate operands/calls/templates, nested evaluation state,
generator AST/block ownership and multi-checkpoint continuation before claiming
that arbitrary generator effects survive restoration.

## Function-state compatibility reconciliation

All 37 function-properties tests now pass. Five low-level cases compare complete
serialize/restore/reserialize graphs for own properties, instances, constructor
prototype chains and mutated Number prototypes. Five public cases compare complete
heap and binding graphs after dump/restore/replay. Unsupported replay-data copying
still rejects rather than dropping state.

The low-level tests exposed differing console shapes in full `run()` captures:
journaled console functions had frozen empty property records, while the fresh
non-journaled realm had none. The independent console fix and its direct parity
regression were committed and verified on remote main as
`aa3ad7f0b8779cd929962a3e68366ee49c0d68af` after 66 focused tests and lint passed.
Release publication must be verified separately. The larger graph restoration
and these compatibility-test edits remain local.

## Generator source-ownership validation

Three forged snapshots initially restored successfully: a low-level generator
claiming another generator's yield or block, and a public generator claiming the
other generator's block. Both restore paths now share source-AST ownership checks,
excluding nested functions and limiting block references to the path containing
the recorded yield. A fourth regression verifies rejection of incomplete block
maps for suspended generators.

The completeness check exposed a real capture gap, not an invalid test: exception
blocks execute through a separate evaluator, so their scope records were missing.
That evaluator now records generator block scopes and selects restored block
scopes without redeclaring their existing lexical bindings. Keep auditing exception
continuations for statements/effects before the target yield; this change alone
does not establish arbitrary exception-continuation correctness.

The console release workflows remain actively monitored: scoped-package run
34042923590 and CLI run 34042923654. Successful publication has not yet been
verified for commit aa3ad7f0b.

## Exception continuation effects

Two direct regressions proved duplicated increments when restoring a yield inside
a try body or a catch body. Exception-block evaluation now skips statements before
the recorded yield using the same target lookup as ordinary blocks (extracted to
`interp/resume-target.ts`). Restoring a catch body bypasses the already-executed
try body and does not rebind its captured catch parameter. A third case preserves
a catch parameter changed before suspension, proving saved catch state is reused.

Resumption inside finally still needs validation of its pending completion,
including saved return/throw/break/continue values. Do not restart the try body or
replace its saved completion with normal completion to make that case pass.

## Pending finally completions

Direct tests reproduced duplicate effects when resuming inside finally, including
pending returns/throws and nested finalizers. Active finalizers now capture their
pending completion keyed by the source try-statement identity. The heap preserves
completion kind, value, labels, source-node identities and diagnostic metadata;
restoration resumes the finalizer without executing the preceding try/catch again.
Shared AST validation rejects unrelated or missing pending-finalizer entries.

A second-checkpoint test caught stale pending completions after execution leaves
finally. Restored pending state is now separate from the active finalizer map used
for the next capture. Completion-delivery tests restore the recaptured snapshot,
not just inspect its sent history. Continue checking break/continue, loop state,
fatal cleanup, completion metadata validation and budget retention; passing these
return/throw tests is not proof of every continuation case.

Console commit aa3ad7f0b has verified scoped publication:
`@poe-platform/safe-js@0.1.211` was published by run 34042923590 at
2026-09-06T15:42:06.7705329Z. CLI run 34042923654 is still monitored separately.

## Loop resumption and labeled blocks

A pending continue through finally exposed a while-loop restart bug: restoration
retested an already-entered iteration's condition and completed before reaching
the recorded yield. While restoration now enters that suspended body directly,
then resumes normal condition checks for later iterations.

A pending labeled break exposed a separate parser limitation: labels only worked
on loops. Labeled blocks now carry label metadata and consume matching labeled
breaks. Parsing tracks active labels, rejects duplicate/unknown labels and
non-iteration continue targets, and resets label scope across function boundaries.
Ten native-comparison cases cover block execution and invalid control labels.
Other labeled statement forms remain to be validated and implemented.

Parser, labeled-block, generator-restoration and exception checks pass all 131
tests; lint and types pass. The full maintained package gate is running again to
identify the remaining integration failures. This parser/control-flow work remains
local and must be delivered separately from unrelated improvements.

## Format expectation reconciliation

The completed full package run reported 15,134 passes, 85 failures and 41 skips.
Two failures were old tests requiring duplicate active labels or delayed runtime
rejection of an unknown label; both now check native JavaScript's parse rejection.

Basic dump/backend/scheduler/public-export writer expectations now assert version
2. Legacy version-one input assertions remain intact, and unknown-version tests
use version 3. These five files pass all 71 tests, including atomic-write failure
and previous-snapshot preservation checks.

Function source, string-concat coercion, template coercion and generator-template
checkpoint tests now resolve heap references before inspecting the same function
or suspended-generator state. Native source-text and restored-result comparisons
remain unchanged. Together with interpreter tests, these five files pass all 615
tests. Historical checkpoint fixtures have not been rewritten.

## Promise and external replay compatibility

All 52 generic Promise tests now replay their snapshots, including custom
constructor/prototype cases that previously expected dump rejection. Those cases
also compare complete recaptured heaps and bindings. All 20 genuine v6 checkpoint
tests pass after changing only the new writer-envelope expectations to version 2;
original fixtures, jobs-v6 semantics, promise replay, initial inputs, recorded call
prefixes and no-extra-host-call checks remain unchanged.

External/signal checkpoint expectations now read version 2, including the cross-run
callback that returns the checkpoint's version. The Object-intrinsic test verifies
mutated prototype state across dump/replay and still rejects lossy plain data
copying. These four test files pass all 123 cases. The full maintained package gate
is running again for an updated remaining-failure list.

CLI release run 34042923654 has passed all validation jobs and entered
release-stable; successful CLI publication still needs log verification.

## Sparse graph checks and mutation assumptions

The next full package result was 15,189 passes, 30 failures and 41 skips. The
OBJ002 sparse-array/alias and combined source-arity tests now assert writer version
2 while preserving every graph identity, hole, property-order and arity check;
all 25 cases pass.

The mutation corpus falsely assumed version 2 and heap ID 99 were invalid. Version
2 is supported and larger intrinsic heaps can contain ID 99. Invalid-version
mutations now use the current version plus one; dangling-reference mutations use
an ID beyond the actual heap, nested as a guest binding value. The corpus passes
its existing case count and time cap. No production validator was weakened.

Console delivery is fully verified: CLI run 34042923654 published
`poe-code@14.0.77` to `latest` at 2026-09-06T15:51:38.1380512Z and completed
successfully. Scoped `@poe-platform/safe-js@0.1.211` publication was already
verified. Stop polling these terminal runs; monitor new pushes separately.

## Accessor preservation checks

All 144 accessor-boundary, object-accessor and string-conversion tests pass.
The object-accessor test independently restores its low-level graph, checks getter
descriptor flags and executes the getter through guest property access. Native
accessor adapters intentionally carry identity only, so direct host invocation is
not used as a guest behavior oracle. Plain-object accessor and retained-prototype
public replays compare complete heaps/bindings; lossy ordinary data copies remain
rejected. Array and boxed accessor snapshots still explicitly reject and require
their own preservation implementation.

Fresh PPR2 continuation and OBJ2 graph assertions, plus the in-memory writer test,
now expect version 2 without changing their native traces, execution semantics,
recorded-effect checks or graph identity assertions.

## Historical EA graph comparisons

The genuine EA fixtures remain byte-for-byte unchanged. Their two compatibility
tests now compare every legacy-representable root/value and heap alias relation
against v2 through `test/helpers/legacy-dump-graph.ts`. The helper enforces a
one-to-one mapping of old and new heap references and canonical intrinsic paths;
negative tests reject changed values, split aliases and wrong intrinsic identities.
New intrinsic descriptor metadata has no counterpart in the old fixture and is
validated by the full new-envelope validator instead of being stripped from the
production snapshot. Existing exact replay/history/input/metadata comparisons,
native results, regex aliases and host-call counts remain in place.

The two compatibility files and helper tests pass 48 cases with one existing skip.
The complete maintained SafeJS package suite is running on the reconciled worktree.

## Reconciled integration gates

The full maintained package suite passed: 15,223 tests, 41 skips, 421 passing files
and one skipped file. All changed SafeJS TypeScript files passed lint and the
package type check. The exact selected workspace build closure also completed
successfully (23 builds across 11 layers).

CLI screenshot QA uses the no-spawn harness pair
`docs/plans/safejs-snapshot-v2-qa.{md,ajs}` with a fresh temporary snapshot path,
then a completed-checkpoint resume. This validation is still in progress; do not
treat the unit/build gates as proof that CLI checkpoint capture works.

The inspected CLI run now passes after correcting labeled-block lint acceptance.
Successful harness runs remove their checkpoint by default in loader/run.ts;
therefore a completed CLI run cannot supply the planned resume input. Resume QA
must use a retained/interrupted checkpoint, not infer success from an absent file.

The real SDK harness loader retained a 126 KB checkpoint using
`preserveSnapshotOnSuccess: true` and `snapshotIntervalMs: -1`. Its result was
`{title:"SafeJS snapshot v2 QA",ok:true,accessorCalls:1,completion:1,label:"preserved"}`.
The actual CLI resumed that checkpoint successfully; both fresh and resumed
screenshots were inspected and showed a passing harness with zero spawns and no
lint warnings. This is completed-checkpoint integration evidence, not a claim
that arbitrary suspended JavaScript expression state is already portable.

## Intermediate expression state

An independent native comparison exposed repeated effects in low-level generator
restoration: `count++ + (yield 1)` returned `[2,5]` after sending 4 instead of
native `[1,4]`; `[count++, yield 1]` similarly repeated its first element.
Four regressions failed before implementation, including repeated checkpoints,
multiple yields, sparse arrays, and completed spreads before suspension.

Active binary and array evaluations now capture their computed left operand or
partial array and current element index. These values travel through the same
identity-preserving graph codec as other guest state. Source ownership validation
requires the exact active expression ancestors and array element index, rejecting
missing or unrelated continuation records. New generators start with isolated
expression state. The focused snapshot/validation checks pass 49 cases.

Repository ESLint completed successfully on the preceding worktree: 9,948 linted
files, zero errors/warnings. Repository type and workflow lint also passed. The
full repository test route passed its 35,333-test Vitest stage, Python tests, and
279 runner tests; remaining virtual-bash execution is still running. These results
predate the intermediate-expression changes, which have their own fresh focused
tests/lint/types and a running full SafeJS suite.

Other intermediate expression forms, iteration/delegation state and specialized
object descriptors remain separate gaps; do not infer their correctness from
binary/array coverage.

A fifth repeated-restoration case, `return [count++, yield 1, count++]`, exposed
stale continuation metadata on completed generators. Omitting only expression
state was insufficient: a second restore of the finished generator retained block
scopes with no yield identity. Completed generator records now omit all suspended
scope/block/finally/expression metadata and yield identity. The 38 focused
generator/source-ownership tests pass; a fresh complete package run is underway.

The fresh package run completed successfully: 15,242 passing tests, 41 existing
skips, 421 passing files and one skipped file. The final focused ESLint and package
type checks also passed. The broader repository run remains in virtual-bash tests;
the next build and visual CLI recheck should follow its terminal result.

The complete repository `npm test` route subsequently finished with exit 0:
35,333 tests in the combined Vitest stage; 29 Python tests; 279 virtual-bash runner
tests; 21,382 virtual-bash tests; 288 terminal-pilot tests; and both posttest lint
stress tests. All declared workspace tasks and required build dependencies ran
through the maintained uncached route. Workspaces without declared tests were
reported as such, not counted as passes.

The selected 23-workspace build closure then passed. Both fresh and resumed CLI
screenshots were re-run and inspected on the final expression-state implementation:
the harness passed without warnings and with zero spawns. The SDK-retained
checkpoint again produced accessorCalls=1, completion=1 and label="preserved".
