# Shared memory and weak-reference audit

Candidate `291ce5fca`, September 9. Read-only native/built-SDK comparisons
confirm missing behavior, not merely missing names: ordinary Int32Array atomic
addition returns [5,12] natively; shared-buffer view aliasing returns 7; WeakRef
dereferencing preserves a strongly held target; FinalizationRegistry unregister
returns true for a registered token. SafeJS rejects each missing global.

## Implementation findings

Atomics integer read/modify/write operations can operate on ordinary ArrayBuffer
storage. This offers an independently testable first increment, without claiming
shared-memory support. The new atomics-nonshared.test.ts covers all update
operations, eight integer view kinds, invalid floating/clamped views, coercion
order, non-shared wait rejection, notify and host lock-free-size results.

The [ECMAScript 2026 DoWait algorithm](https://tc39.es/ecma262/2026/multipage/structured-data.html#sec-dowait)
checks whether the agent may suspend. A future synchronous wait implementation
must not accidentally block the host event loop. Shared waits and their timeout,
notification, cancellation and replay behavior remain a separate integration
task, not a stubbed successful operation.

Current typedArrayStorage explicitly rejects buffers whose native prototype is
not ArrayBuffer.prototype; ArrayBuffer length/options helpers call ArrayBuffer
accessors. SharedArrayBuffer support therefore spans the buffer/view storage
model, allocation and growth accounting, alias-preserving copy/checkpoint paths,
host admission and intrinsic dispatch. Adding only a constructor is insufficient.

[WeakRef construction and dereferencing](https://tc39.es/ecma262/2026/multipage/managing-memory.html#sec-weak-ref-objects)
keep returned targets alive through the relevant execution interval. SafeJS
internally awaits native promises during guest execution, so a thin native
WeakRef wrapper alone would not establish guest-job lifetime guarantees.
The existing SandboxJobQueue is the relevant scheduling boundary to audit.
Finalizer execution also needs scheduler, budget, realm and shutdown handling.
The [host weak-reference processing rules](https://tc39.es/ecma262/2026/multipage/executable-code-and-execution-contexts.html#sec-processing-model-of-weakref-and-finalizationregistry-targets)
provide the reference, not an assumption that cleanup occurs promptly.

No existing host shared-buffer admission rejection was relaxed. Shared storage,
weak references, and publication remain pending.

## Reproduced regression baseline

The focused Vitest run (session 57516) completed with exit 1: all 31 cases
failed in 2.85 seconds. Native assertions passed; guest assertions demonstrate
the missing Atomics global. Six additional cases cover invalid indices
suppressing value coercion, compareExchange argument order, shrinking during
index coercion, detaching during value coercion, and Number/BigInt mismatches.
These are regression requirements, not implemented functionality.

Existing sandboxNumber and sandboxBigInt provide guest-aware conversions.
The implementation must capture initial view validity and length before guest
index conversion, then follow operation-specific revalidation after conversion;
passing already-coerced arguments to a native method alone can change the order
of observable failures. Preserve argument roots across guest calls using the
existing retained-value mechanism. Register the namespace and its functions
with the intrinsic identity system so replay and foreign-realm errors retain
their ownership.

## Concurrent package gate status

An unconnected Atomics factory is now implemented in globals/atomics.ts.
Twelve standalone cases pass (session 17101, 79 ms test time), covering numeric
operations, guest Number/BigInt conversion hooks, and namespace descriptors.
Lint and TypeScript checks pass (session 20383). Two additional integration
cases now cover aliased-storage replay with the global binding replaced and
foreign intrinsic error ownership. The expanded baseline (session 43520) has
12 passing standalone cases and 33 failing guest integration cases. These
integration cases remain pending until the factory is wired into
builtin globals after the unchanged-input package run terminates. This is not
yet a shipped or integrated feature. The initial TypeScript check identified
the project's older library declarations lacking Atomics.waitAsync; the factory
now captures that native method through Reflect.get without widening tsconfig.

Session 21369 started before atomics-nonshared.test.ts was added. Its original
1,302 source/test inputs have SHA-256
f02fa8d837b87e731d944737740e0f6a90fc06d89011f287362c68fe9e5eaa06.
The new Atomics regression file and unconnected factory module are not covered
by that already-discovered run. Exclude both when rechecking its original hash.

## Integration after the package gate

Session 21369 terminated with 24,819 passes, two host-Promise property-policy
failures, and 37 skips. Its original hash matched after termination. Atomics
was then connected to builtin globals. The initial integration run passed
44 of 45 tests; the remaining comparison exposed a Node 22 oracle discrepancy.
For a length-tracking view at byte offset zero, shrinking the buffer to zero
does not make the view out of bounds. RevalidateAtomicAccess step 5 requires
RangeError for the stale byte index; Node 22 reports TypeError. The regression
now explicitly follows the specification instead of that native result.

Final focused checks: all 45 Atomics cases pass; the combined reflection and
foreign-error run passes 119 tests. The missing lint declaration was separately
reproduced by two failing tests before adding Atomics to known globals. The
combined lint/Atomics run then passed 666 tests across 50 files. Snapshot and
arity coverage passed 1,718 tests across 128 files. ESLint, TypeScript, the
maintained 23-workspace build, and four fresh-import checks passed. Built
runtime probes passed for lint admission, aliased-storage replay and BigInt
operations. README limitations now distinguish ordinary-buffer Atomics from
the still-missing shared-memory implementation. No publication was performed.
