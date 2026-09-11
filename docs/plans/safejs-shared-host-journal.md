# Shared host-call journal integration

## Confirmed defects

The initial managed shared-boundary baseline failed five tests and passed the
raw-host-storage rejection control (session 71442). Shared argument digests
ignored bytes, capacity, storage kind and within-argument block aliasing. A
guest-created shared buffer returned unchanged by a host function was rejected.

The current draft includes shared storage metadata and traversal-local block IDs
in argument digests, includes shared backing for fixed typed-array digests, and
admits only already-managed shared buffers through host result copying. The
first six cases and existing host-call unit tests passed 23 cases (session 30334).
Returning a shared typed-array view also passes. Raw host buffers remain rejected.

The expanded regression file has two remaining failures (session 59762):

- A host-returned alias loses sharing with its guest argument on completed replay.
  The original returns `[true,7,4]`; replay returns `[true,0,4]`.
- Journaled outcome bytes change after settlement when the live returned shared
  buffer changes. The stored byte changes from zero to seven in a later dump.

## Required next work

Do not re-execute consumed host calls to repair sharing: they may have effects.
Do not globally change structuredClone to copy shared bytes: live shared cloning
must continue to share storage. Do not admit arbitrary native host shared blocks
without accounting, identity and external-lifetime rules.

Journal storage needs both a frozen settlement-time data graph and an explicit
association between returned blocks and the call's existing shared arguments.
Replay must reconnect distinct returned wrappers to the appropriate current-run
block without merging independent blocks with equal bytes. Preserve view identity,
offsets, capacity, fixed/tracking layout, and wrapper properties. The association
must be validated before applying replayed writes or exposing the outcome.

Relevant paths:

- host-bridge.ts copies guest arguments, computes the digest, and issues the call.
- HostCallJournal.retainOutcome currently uses cloneSandboxValue, whose shared
  cloning correctly retains live sharing but is unsuitable for frozen history.
- snapshotReplay serializes each outcome as a separate replay-data graph.
- replayOutcome decodes that graph without references to the current arguments.
- Callback graphs and cross-call aliases will need the same identity audit;
  fixing a single direct return must not be presented as complete host replay.

The snapshot suite passed 1,728 tests in 129 files (session 87121, 44.52 seconds)
before these host-boundary edits. That result does not cover the new journal
failures. The expanded failing tests remain in the working tree. No release or
complete shared-host support is claimed.

## Settlement isolation draft

Journal outcome copying now supplies a per-copy shared-block snapshot map.
The storage helper allocates a new block for the first wrapper, copies bytes
and growth capacity, and clones that isolated block for subsequent wrappers.
The ordinary live clone path is unchanged. Copy-state propagation through views
keeps each view attached to its corresponding copied wrapper.

The combined host/shared guest check passed 56 cases with one remaining failure
(session 10698): reconnection to the current call's arguments during replay.
Both settlement regressions pass, including growth after settlement, DataView
aliases, independent equal blocks, distinct wrappers and writes to a decoded
copy. This is not a completed host-journal implementation.

For reconnection, retain a validated association between captured outcome block
identities and call argument block identities. The frozen-copy map can supply
that association without storing native pointers in the checkpoint. Replay must
validate the entire graph and all associations before modifying current-run
shared bytes or growing a current-run buffer. View creation must see the restored
capacity. Also test host writes to arguments not present in the returned graph,
callbacks, multiple calls, rejection outcomes and independently equal blocks.

## Argument reconnection draft

The journal now collects shared argument blocks during the existing deterministic
argument traversal. Settlement copies record both the result and snapshots of
all shared argument blocks. Replay data carries associations from shared heap
records to argument-block indices, with a shared-state envelope only for calls
that use shared arguments. Ordinary call encodings remain unchanged.

Replay validates association shape, safe integer indices, unique blocks and
argument indices, and the shared effect envelope. The reconnection helper checks
all capacities and block associations and copies the full result graph once as
validation before it changes any current-run shared storage. It restores growth
and bytes, then copies wrappers/views onto the explicitly matched blocks. It does
not re-run consumed host calls. Independent equal blocks are not merged.

The first integrated check passed 31 tests (session 37376), including the original
returned-wrapper replay failure. An expanded test then found that writes/growth
were lost when a host returned a number instead of its shared argument (session
23453: 1 failed, 12 passed). Recording all shared argument effects fixed that gap.
Seven malformed-association cases first passed validation incorrectly (session
88233); all now reject. The subsequent check passed 41 cases (session 92272).

Remaining audits: async mutation timing, callbacks, cross-call relationships,
rejected host results, retained-data accounting, and failure atomicity around
budget reconciliation. These focused results do not establish complete shared
host-journal support. No new publication or remote delivery is claimed.

## Async visibility audit

Two tests reproduced premature replay writes for fulfilled and rejected async
host calls: original guest code read zero before await, while replay read seven
(session 73757). Shared outcome restoration is now deferred to the recorded
promise-settlement event. PromiseReplay accepts a synchronous settlement transform
that runs inside its existing event gate, without adding another tracked promise.
Fulfillment and rejection transformations preserve their channels; failures reject
the promise, and fatal budget rejections bypass transformation.

The original async cases and shared-boundary tests passed 22 cases (session
41518). Broader promise order, failure replay, replay stress and shared tests
passed 161 cases (session 79932). Four direct settlement-transform tests passed
(session 75939); scoped lint and TypeScript passed (session 47497).

The complementary synchronous-prefix case is now under test: an async host
function may mutate shared memory before its first native await. Applying all
recorded effects at final settlement cannot preserve that earlier visibility.
The journal currently records final shared effects only. Next work must capture
and validate invocation-prefix effects separately, preserve final-settlement
effects, and avoid re-running consumed host calls or applying a prefix twice
when a pending operation is legitimately re-issued. Intermediate asynchronous
host writes before final settlement need a further event-boundary audit.

## Invocation-prefix implementation

Async calls now capture an isolated shared-storage prefix immediately after the
native invocation returns its promise. Completed replay applies that prefix at
invocation and the final shared effects at the recorded settlement. Prefixes are
validated as non-empty arrays of unique managed shared blocks, copied with record
metadata, and included in journal retained-data accounting. A prefix attached to
a synchronous record was accepted by the initial validator; the regression now
rejects that contradiction (baseline session 57491).

Six timing cases passed (session 3700), including separate growth at invocation
and settlement and reissuing a pending call without applying its prefix twice.
The broader check passed 174 cases in seven files (session 10965).

A further test reproduced lost prefixes when reconciling a pending read-side-
effect operation rather than reissuing it: expected `[1,1]`, received `[0,0]`
(session 97512). That reconciliation path now restores the recorded prefix before
requesting external proof, without invoking the host operation again. Final
proof-time shared effects, intermediate async writes, cross-call identities,
callbacks and budget-failure paths still require audit.

## Budget failure ordering

The invocation-prefix promise-handling audit passed without a code change. The
test observes both the original native promise and promises produced by host
cleanup; each already has a rejection handler when recording fails. It releases
and handles all test promises explicitly rather than producing a real unhandled
rejection to test the hypothesis.

A different budget failure was reproduced: synchronous replay wrote byte seven
to a target before outcome retention failed (session 17298: one failure, one
passing control). Replay now retains the decoded outcome and its recorded shared
argument snapshots before applying invocation or final effects. Mapping and
effect closures keep current-run targets separate from the frozen retained graph.
This also preserves the recorded graph's own sharing for memory accounting.

The first integrated recheck passed 33 cases (session 77466). The expanded budget
regression checks both synchronous effects and asynchronous invocation prefixes,
including growth, and asserts that neither bytes nor target length change after
the injected retention-budget failure. This does not close every possible budget
or shared-memory failure-atomicity audit.

The expanded budget/shared failure group passed 47 tests (session 49668), and
scoped lint and TypeScript passed (session 11184). The maintained selected SafeJS
workspace build passed 23 builds and four fresh-import checks (session 61570).

Full SafeJS package unit validation is now running in session 23054, against
1,320 source/test files with combined path/content SHA-256
`07c073a346ff9d2865c66b9cbdf3d9c03a95af34515be4b063bc049cd3e4b2b3`.
The hash includes the integrated uncommitted work and unrelated existing changes;
it is not an isolated commit hash. Verify terminal results and input stability
before describing this gate as passed.

Gate 23054 is now terminal: 24,991 tests passed, two failed, and 37 skipped
across 986 files (984 passed, one failed, one skipped), in 672.11 seconds.
Both failures are the native host-Promise own-property import cases in
`promise-import-properties.test.ts`; this is not a green package gate. The
post-run 1,320-file digest exactly matches the pre-run digest above. The
cross-call probes were not tests in this frozen candidate and must not be
counted among its passing cases. Runtime/test editing can now resume.

## Validated cross-call retained storage gap

A read-only probe against the selected build reproduced this source:

```javascript
const b = new SharedArrayBuffer(4);
save(b);
const result = mutate();
return [new Uint8Array(b)[0], result];
```

The host `save` retains its buffer argument. The later host `mutate` writes
`9` to byte zero of that retained buffer and returns `17`, without receiving
the buffer as an argument. The original run returns `[9,17]`; replay of its
JSON-round-tripped dump returns `[0,17]`. Both runs report success. The total
host invocation count remains two, proving replay did not invoke either host
operation again. This is concrete evidence, not just an identity hypothesis.

Two additional built-runtime probes return a distinct wrapper from `save` and
read both wrappers after `await mutate()`. Synchronous and asynchronous mutate
variants both produce `[9,9,17,false]` originally and `[0,0,17,false]` on replay,
with exactly two native calls total. Wrapper inequality is preserved; shared
write visibility is what fails. The asynchronous variant awaits a native
resolved promise before writing, confirming this is not confined to synchronous
settlement. These probes run in memory and do not alter the active gate inputs.

The opposite exposure direction also fails. A host `make` returns managed
growable storage created through `createSharedArrayBufferStorage(4,8,budget)`;
an argument-less later `mutate` grows that retained block to eight bytes and
writes byte seven. Original `[b.byteLength, view[7], result]` is `[8,9,17]`,
whereas replay produces `[4,undefined,17]`, again with only two host invocations.
The probe uses managed storage deliberately: raw native shared storage is
rejected by the existing host boundary and is not a valid control for this gap.
Both the write and growth effects are missing, so a registry limited to guest
arguments would still leave a reproduced failure unfixed.

The current per-call argument collector cannot capture a later operation's
effects on previously exposed storage. The next regression must cover retained
argument storage, host-returned storage subsequently mutated, distinct wrappers
sharing one block, and independent blocks. An implementation must track exposed
blocks across the journal lifetime with budget accounting and disposal; merely
adding the current call's arguments again cannot repair this case. Preserve
invocation-prefix versus settlement ordering and validate all recorded mappings
before mutation. No runtime or test file was changed during full gate 23054.

Source inspection identifies the boundary: `registerSharedArguments` stores only
the current call's collected blocks, and `retainOutcome` deletes that live list
after freezing the outcome. A later argument-less call therefore has no targets
to snapshot. A control passing two distinct wrappers of the same block directly
to one host call correctly returns `[7,7,7]` on both original and replay, with
one native invocation. The digest collector already deduplicates by storage
block, so do not repair that working path as if it caused this failure.

Implementation constraints for the cross-call regression:

- Keep a journal-wide identity table for storage exposed to host operations,
  distinct from per-call frozen effect graphs. Register at the actual exposure
  boundary, including returned values, rather than registering every guest
  allocation or only discovering buffers at final settlement.
- Record which stable identities each prefix and settlement updates. A fixed
  argument index alone cannot address an argument-less later operation. Reject
  duplicate, unknown, or contradictory identities before changing live bytes.
- Reconstruct those identities as replay executes prior calls. Preserve aliases
  across results and future arguments while retaining distinct wrapper objects.
- Include live exposed storage in the journal's retained-value roots, account
  for registry metadata and frozen bytes, and clear roots on disposal. A strong
  map without these steps would hide retained memory from the budget.
- Preserve historical per-call decoding explicitly if the wire representation
  changes. Test synchronous, asynchronous, rejected, growth, and independent-
  block cases; do not apply asynchronous settlement effects at invocation.

## Validated intermediate asynchronous observation

A deterministic three-call probe now reproduces the intermediate-write gap:

```javascript
const b = new SharedArrayBuffer(4);
const a = new Uint8Array(b);
const pending = mutate(b);
await checkpoint();
const middle = a[0];
finish();
await pending;
return [middle, a[0]];
```

Native `mutate` awaits a first gate, writes `1`, signals that write, awaits a
second gate, then writes `2`. Native `checkpoint` opens the first gate and waits
for the write signal before resolving. Native `finish` opens the second gate.
There are no timers, sleeps, or races in this ordering. Original execution
returns `[1,2]`; completed replay returns `[0,2]`, with exactly three native
calls across both runs. Final settlement effects work; the write observed after
the intervening checkpoint is missing. This establishes an actual failure in
addition to the earlier final-effect cross-call cases. Recording all exposed
blocks at host event boundaries must include checkpoints of still-pending
operations, not only their own initial invocation and final settlement.

After frozen gate 23054 completed, these probes became four source-runtime
regressions in `shared-host-cross-call.test.ts`. Baseline session 87046 fails
all four exactly as the built probes predicted: synchronous and asynchronous
retained aliases lose both byte reads; host-returned growth stays at four bytes;
the intermediate async observation reads zero instead of one. All original-run
control assertions pass. The focused run takes 1.83 seconds, with 259 ms of
test execution. No production fix has been applied for these cases yet.

## Journal-wide argument tracking in progress

The first implementation keeps a block-deduplicated exposed-argument registry
for the journal lifetime. Registry entries have retained-data metadata charges;
their buffers participate in retained-value roots and are cleared on disposal.
New records use an explicit `sharedRegistry: true` marker; legacy replay records
without the marker retain per-call argument indexing. Malformed marker rejection
was added after its new regression failed (session 2599).

Both synchronous and asynchronous retained-argument regressions now pass. The
host-returned-storage case is still red. The intermediate case changed from
`[0,2]` to `[1,1]`: the checkpoint now restores the intermediate byte, but a later
unchanged full-buffer snapshot overwrites the final byte. This is evidence that
simply replaying full images at every call boundary is insufficient; effect
ordering or change tracking must prevent stale observations from becoming writes.
Do not claim this partial implementation completes cross-call replay.

Session 82323 reports 38 passes and these two remaining failures across five
shared host files. The exposed-root/disposal and malformed-marker tests pass.
Package TypeScript passes (60639). No full-package rerun or commit of this
in-progress extension has occurred yet.

## Cross-call ordering and returned storage follow-up

The journal now records capture-order numbers for invocation prefixes and final
effects. Replay tracks the last applied order per live block; older images can
reconnect result wrappers without overwriting newer bytes or growth. A direct
helper regression failed before this non-writing rebind path (79614).
The pending three-call case now reproduces `[1,2]` correctly.

Managed shared storage imported from host values is registered at its existing
copy boundary. Replay registers shared storage in reconstructed outcomes at
synchronous return or recorded async settlement, allowing later argument-less
calls to restore mutations of host-returned buffers. The four original cross-call
regressions all pass (31665: 45 tests across six files).

Six malformed-order cases initially failed (18291). Orders are now positive safe
integers below the overflow boundary, unique across captured events; prefix and
outcome markers must be consistent, and a final event cannot precede its prefix.
The expanded shared/host-call/Promise replay selection passes 86 tests in eight
files (72075), and package TypeScript passes (35452). This is focused evidence,
not a new full-suite result. Further concurrency, callback, independent-block,
budget/disposal, and legacy-format audits remain; no commit or delivery yet.

Selected workspace build 13998 completed: 23 builds and four fresh-process
SafeJS import checks passed. Four additional cross-call controls now pass:
independent retained blocks through synchronous/asynchronous rejection, and
repeated nested host returns preserving shared storage with distinct wrappers.
The 16-case cross-call selection passed (41925); its scoped lint passed (8797).

## Callback boundary gap reproduced

A host operation that writes byte one before its first await, calls a guest
callback, and finally writes byte three replays correctly in a built-runtime
control: `[1,3]` in both executions, one native call. When the operation first
awaits a `setImmediate` barrier, writes byte two, invokes the guest callback,
then writes byte three, the original result is `[2,3]` but replay is `[0,3]`.
The guest callback saves the current byte and increments it. Native invocation
count remains one. This distinguishes the already-recorded invocation prefix
from an unrecorded later callback observation.

The source regression `restores shared writes before a callback invoked after
a host await` was added after the selected build completed. Baseline 44187
fails on the callback's observed byte. `recordCallback` currently records only
callback arguments and scheduling step; the replay start path decodes those
arguments and invokes the guest without restoring current shared storage.
The repair must capture shared effects at callback invocation, preserve their
global capture order, and bind shared callback arguments/receivers to the same
live registry blocks. Include callback metadata in retained-data accounting
and malformed-state validation, and preserve reissued-call argument comparison.

## Callback shared-state implementation

Callbacks now record a shared-state envelope containing invocation values and
the exposed registry blocks in one encoded graph, with a global capture order.
Replay restores and rebinds that graph before invoking the guest callback;
legacy callbacks still decode their original argument record. Invocation
arguments remain separately available for pending-call reissue comparison.
Both encoded graphs are included in retained-size accounting. Envelope shape,
unique shared blocks, argument arity and paired order metadata are validated.
Registry blocks first exposed through a callback are registered for later calls.

The original callback regression passes (23795: 34 tests in two files). A new
receiver/argument alias control also passes: callback reads `[2,2,2]`, writes
through its argument, and the guest sees byte seven afterward. Package TypeScript
passes (85419). The broader callback selection (38173) reports 113 passes and one
five-second timeout in the bounded-map successive-checkpoint case; it is not a
green run. Its isolated five-variant recheck passes (90899, 5.12 seconds total
test execution). A one-worker rerun of the full focused selection is underway to
separate contention from a repeatable functional failure; no timeout was raised
or test removed. Callback budget-failure atomicity and adversarial envelopes
still need dedicated regression coverage.

The one-worker rerun completed successfully: 114 tests in eight files passed
(95708), with original timeout limits unchanged. This supports contention as
the cause of the earlier timeout but does not prove performance under the full
package's normal parallel workload. Scoped lint passes (96277).

## Callback registration-budget ordering

A targeted failure injection reproduced a callback replay atomicity defect:
registering a newly exposed block exceeded the registry budget after an existing
target had already been changed from zero to seven (7829). Callback replay now
registers new targets before restoring any shared effects, so registration-budget
failure leaves existing guest bytes unchanged. This does not claim rollback of
all possible internal allocations or fix every remaining budget path.

Build 95542 passed 23 builds and four import checks before this final ordering
change. Its compiled artifact does not include the subsequent two-line reorder;
source-level regression and type checks cover that follow-up separately.

The budget follow-up passes 33 focused tests (18739), package TypeScript (26776),
and scoped lint (48644). Shared-memory changes are now selected in a private Git
index at `/tmp/safejs-shared-commit.eCW6K7/index`, excluding unrelated weak-
collection and generator changes. The real index still contains only the three
existing SafeBash files. The private index was exported to
`/tmp/safejs-shared-commit.eCW6K7/candidate` for exact-candidate verification;
export 96755 completed and selected build 78157 is running there. An initial
test command ran before export completion and found no files; it is not a test
result and must be rerun after the candidate build. The index snapshot predates
this administrative paragraph. No commit or push has occurred yet.

## Exact candidate verification and prerequisite repair

The first isolated build (78157) caught incorrect selected-hunk offsets plus a
syntax error in committed generator metadata placement. Selected hunks were
reassembled with offsets derived only from included changes. The generator
relocations already present locally were isolated from weak-collection work and
committed separately as 7c8a751f1, preserving working-tree contents.

The corrected candidate passes package TypeScript (45924), 225 tests with one
skip in nine files (93303), and scoped lint (48431). Its maintained selected
workspace build passes 23 builds and four fresh-import checks (8066). These
checks cover the actual selected source without unrelated weak-collection edits;
they are not a new full-package or full-repository gate. The earlier integrated
full run remains 24,991 passes, two host-Promise import failures, and 37 skips.
No remote delivery or release is claimed. Callback adversarial-state coverage,
remaining budget paths, native waiter disposal, host Promise import policy,
WeakRef/FinalizationRegistry semantics and broader conformance audits remain.

## Standard-version audit

A separate built-runtime presence probe on Node 22.23.2 reports `undefined`
for SafeJS `Atomics.pause`, `WeakRef`, and `FinalizationRegistry`. Native Node
reports `undefined`, `function`, and `function`, respectively. The current
ECMAScript 2027 draft lists `Atomics.pause`; the published ECMAScript 2026
Atomics list does not. Track pause as a newer-draft surface, not as evidence
that an ES2026 method was omitted. Weak reference lifetime semantics remain
a separate required design audit; native wrappers alone do not establish
guest-job lifetime or snapshot correctness.

Sources:
- https://tc39.es/ecma262/multipage/overview.html
- https://tc39.es/ecma262/2026/multipage/ecmascript-language-scripts-and-modules.html
