# Shared storage integration findings

Candidate: 098e503fd. Ordinary-buffer Atomics is integrated; SharedArrayBuffer
is not. The first focused baseline failed 18 cases; the expanded baseline
(session 80598) failed 20 cases in 3.79 seconds. Native assertions passed,
including async waiter notification and shared structured cloning. A further
regression checks replay of two distinct wrappers sharing one backing block.
The final baseline (session 96385) confirms all 21 regressions fail against the
current runtime in 4.85 seconds. Guest integration remains incomplete.

## Storage identity is distinct from wrapper identity

The current copy and snapshot maps use ArrayBuffer wrapper identity as their
backing-store key. That works for ordinary buffers, but not for shared buffers:
structuredClone produces a distinct wrapper referencing the same data block.
The [structured serialization algorithms](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
preserve shared data and growth metadata; ordinary buffers instead copy bytes.
Shared buffers are not transferable. This host API is separate from ECMA-262
language semantics; SafeJS already exposes it and needs compatible behavior.

The implementation needs a shared block identity record propagated whenever a
guest shared wrapper is cloned. View aliasing, retained-data accounting and
checkpoint references must use that record, while object equality, properties,
prototypes and wrapper allocation remain per-wrapper. Do not merge distinct
wrappers just because their bytes are equal. Do not copy bytes for guest
structuredClone and silently lose sharing.

## Current integration boundaries

- interp/array-buffer.ts captures only ArrayBuffer accessors and copies storage.
- interp/typed-array.ts rejects any backing prototype other than ArrayBuffer;
  its resize-based out-of-bounds restoration cannot be used for monotonic growth.
- interp/data-view.ts independently rejects shared buffers and assumes resize.
- interp/values.ts handles admission, cloning, accounting and retained properties;
  unrelated weak-collection changes in this file must be preserved.
- snapshot/array-buffer.ts encodes ordinary bytes, resizable capacity and
  detachment; shared block identity and growability need explicit representation.
- snapshot/typed-array.ts and snapshot/data-view.ts need to retain fixed versus
  length-tracking layouts and refer to shared storage records consistently.
- globals/structured-clone.ts currently permits only ordinary buffers in transfer
  lists. Keep shared buffers rejected there while implementing shared cloning.
- globals/atomics.ts currently rejects non-shared waits before argument coercion
  and returns zero for non-shared notify. Shared paths need actual waiter behavior,
  not those ordinary-storage outcomes.

JSON checkpoints cannot retain a live native pointer shared with an external
agent. Guest-local restoration must preserve block aliases within the restored
graph. Externally shared storage and pending waiters require an explicit runtime
lifetime/checkpoint policy; do not claim that a byte dump restores live external
synchronization. Audit host admission separately from guest-created buffers.

## Verification and remaining work

The regression file covers fixed/growable metadata, typed-array and DataView
aliases, slice copies, monotonic growth, receiver validation, coercion order,
Number/BigInt atomics, immediate waitAsync results, real notification, shared
structured cloning, and replay. Further coverage is required for species,
foreign constructors/errors, bounds and budget failures, transfer rejection,
timeouts/cancellation and checkpoint validation against malformed shared graphs.

Full-package session 5896 is running against the prior 1,305 inputs with hash
6a473f2b78c9f41a890dbabc43a7aa6c8b28b77747c58ec3e73915e0894d2893.
The new shared-array-buffer.test.ts was added after discovery and is excluded
from that gate. Existing runtime inputs have not been changed during this audit.

## Storage identity implementation in progress

interp/shared-array-buffer.ts now allocates budget-checked shared buffers and
records their backing-block identities. Its cloning operation uses native shared
cloning and propagates block identity to the distinct wrapper. Metadata uses
captured native getters, not guest-accessible properties. Block records do not
retain a representative wrapper, which would unnecessarily retain that wrapper's
guest properties while only a clone remains reachable. Only internally registered
storage is admitted; raw host buffers and proxies remain rejected.

All 15 low-level tests passed (session 91502), including invalid dimensions and
array/data allocation limits. ESLint and TypeScript passed (session 69049).
The original package-run input hash still matches. This module is not yet
connected to guest values, views, accounting, globals or snapshots. The new
interp/shared-array-buffer.ts and interp/shared-array-buffer.test.ts must also
be excluded when rechecking the running package gate's original input hash.

## Shared storage snapshot codec

snapshot/shared-array-buffer.ts now encodes one byte payload per block, with
subsequent distinct wrappers represented by a block reference. Decoding a block
reference clones the registered wrapper instead of returning it directly, keeping
object identity distinct while preserving aliasing. Capacity is retained for
growable storage. Ordinary/unregistered references, detachment flags, conflicting
storage descriptions, invalid bytes and invalid capacity are rejected. Allocation
and traversal use the existing budget checks.

The codec and identity tests passed 32 cases together (session 92072), including
sparse-byte and equal-independent-block regressions. The codec is not yet
connected to serialize/restore dispatch or snapshot graph validation. Its module
and test (snapshot/shared-array-buffer.ts and .test.ts) are new after package-gate
discovery and must be excluded when verifying that run's original hash.
ESLint and TypeScript checks passed (session 85256). No publication or complete
guest-checkpoint support is claimed by this internal codec increment.

## Constructor/prototype draft

An unconnected globals/shared-array-buffer.ts now implements constructor option
coercion, prototype selection, metadata accessors, species, grow and slice. The
expanded native-backed regression baseline has 23 guest cases (session 10553).
Two new requirements are slice rejection when a species result is a distinct
wrapper of the source block, and growth revalidation after coercion changes size.

Three direct factory tests (session 86920) currently fail at setSandboxPrototype:
the existing supported-object predicate does not admit managed shared buffers.
TypeScript (session 17762) likewise rejects the constructor/slice results because
SandboxValue excludes SharedArrayBuffer. These are pending integration edits,
not passing checks. The draft remains uncommitted. Do not cast around either
boundary; extend the guest type and supported-object handling with the managed
shared brand, then integrate accounting and views.

This new globals/shared-array-buffer.ts is also excluded from session 5896's
original inputs. No original runtime input was edited while that run remained
live.

After session 5896 terminated and its original hash was verified, SandboxValue
and RuntimeSnapshotValue were extended with SharedArrayBuffer. Managed shared
buffers are accepted by prototype linking. Data measurement now counts bytes
once per block and counts each wrapper and its non-enumerable properties.
Three accounting regressions first failed (session 47979); all then passed.
The direct slice test additionally reproduced a missing SDK accessor bridge;
constructor, grow and slice now provide the existing builtin-call bridge when
no interpreter context is supplied. All six focused direct/accounting cases
passed (session 64642). ESLint and TypeScript passed (session 82171).
These integration edits remain uncommitted and the global is not yet installed.

## Guest integration (uncommitted)

SharedArrayBuffer is now installed in builtin globals. Shared backing storage
works in numeric typed arrays and DataView, without admitting shared receivers
to ordinary-buffer slice/transfer/resize methods. Shared structuredClone preserves
backing-block identity. Constructor getter registration was moved after intrinsic
identity registration to avoid colliding with Promise's Symbol.species getter.

Atomics supports shared notify and waitAsync, including immediate non-equal/zero
timeout results and actual notification through an alias. Async native results
are bridged into guest promise capabilities. The agent cannot suspend in
synchronous Atomics.wait; argument conversions occur before that rejection.
Pending-wait cancellation, timeout lifecycle and checkpoint semantics remain
unverified and require further work.

A direct serialize/restore test initially failed on shared storage as a host
reference (session 28158), despite source-replay examples passing. The dedicated
shared codec is now connected to serialize, diagnostic dump, restore and heap
validation. The direct round-trip verifies separate wrapper identities, aliased
view buffers, and isolation from the original live block after restoration.
All 44 shared guest/codec tests passed (session 52481), and TypeScript passed
(session 25101). The broader Atomics/shared suite passed 71 cases before direct
codec dispatch was integrated (session 15519).

Source-lint admission, host/replay transport, malformed shared reference cycles,
pending-wait behavior, broader regression checks and final documentation remain
open. No complete shared-memory compatibility or delivery is claimed.

The source-lint case first failed with AS003 for SharedArrayBuffer (session
74741), then the implemented global was added to known-globals. The README
now labels this work experimental and uncommitted rather than claiming that
SharedArrayBuffer is absent. Scoped ESLint passed (session 63551). Host/replay
transport, shared reference cycles and waiter lifecycle remain open.

## Replay transport integration (uncommitted)

Two direct replay regressions reproduced rejection of managed shared buffers as
unsupported host objects (session 89371: 2 failed, 18 passed). Replay encoding now
tracks backing-block references separately from wrapper references, and decoding
uses the shared-storage codec with the compilation owner's budget or a local
budget for standalone decoding.

The expanded check passed 69 tests across shared storage, ordinary buffers,
replay data and graph extension (session 53360). It covers view-first traversal,
distinct wrappers sharing restored memory, isolation from the original block,
growth with tracking DataView and fixed typed-array layouts, non-enumerable
properties and non-extensibility. Self/cross-referencing malformed shared blocks
already reject with TypeError via replay depth limits; no speculative cycle fix
was needed. The first growth fixture used native views without maintained layout
metadata and was corrected to construct supported managed-layout views; this
does not establish support for importing arbitrary native growable views.

Scoped ESLint and TypeScript completed successfully (session 71262). Full runtime
integration, host transport and async waiter lifecycle remain unfinished.

The two untouched historical checkpoint comparisons then reproduced an exact
extra SharedArrayBuffer global (session 62365: 2 failed, 42 passed, 1 skipped).
Their explicit list of post-checkpoint intrinsic additions now includes that
constructor; the historical captures were not rewritten. Both files passed
44 cases with one skip after the update (session 69636).

## Async waiter evidence

Six new tests pass (session 76113): finite native timeouts remove their waiter;
notifications respect registration order and byte location; completed waits
replay; an external replay checkpoint with a pending waiter resumes through an
explicitly re-issued async host gate; and cancellation interrupts an atomic
await. Native VM comparisons cover timeout and notification cases.

The pending-checkpoint fixture initially requested capture during an active host
call, correctly triggering the reentry guard. It now uses the maintained external
replay mode after the host boundary settles. A second stall was isolated to the
replay stage: the replacement host gate returned synchronous undefined instead
of retaining the original promise-returning contract. Keeping it async made the
case pass, and its re-issue policy is now explicit. No Atomics runtime change
was justified by these failures. The behavior of mismatched host return contracts
is a separate diagnostic candidate, not a validated shared-memory defect.

These tests do not prove native waiter disposal after abandoned/cancelled runs,
direct restoration of a pending waiter continuation, external shared-agent
coordination, or deterministic timeout replay. Those remain open.

## View boundaries and malformed snapshot cycles

Four additional guest checks passed with the existing implementation (session
34297, 30 tests total): Float16Array byte-level aliases, fixed versus tracking
growth, shared structured cloning/replay, and rejection of mixed ordinary/shared
transfer lists without partially detaching the ordinary entry.

Direct snapshot restoration did have a defect: one-node and two-node shared
backing-reference cycles both exhausted the native call stack (session 27689:
2 failed, 23 passed). Storage reference resolution now tracks active heap IDs
and rejects cycles explicitly with TypeError. This does not reject ordinary
object-property cycles: a positive direct snapshot test checks peer properties
between distinct shared wrappers as well as their shared bytes.

The shared/ordinary/detached snapshot group passed 61 tests (session 33266).
The expanded shared snapshot and guest tests passed 55 tests (session 99478),
scoped ESLint passed (session 1491), and TypeScript passed (session 81125).
Changes remain part of the uncommitted shared-memory integration; successful
publication is not claimed.
