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
