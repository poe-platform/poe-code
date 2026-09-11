---
title: Reflect validation
---

# Validated Reflect gap

After Float16 delivery at 618827fc4, current source rejects
`Reflect.ownKeys({answer:42})` with UNBOUND_IDENTIFIER; native Node returns
`["answer"]`. The first regression table covers all thirteen Reflect methods,
namespace metadata, primitive-target validation before key coercion, receiver
semantics, boolean operation failure and propagation of guest exceptions.
All sixteen cases failed against the current source before implementation
(1.31 seconds); their expected values execute independently in strict native JS.

Implement the complete Reflect namespace using sandbox object operations, not
native Reflect on interpreter records. Share existing descriptor conversion,
virtual prototypes, argument-list coercion and invocation helpers where their
semantics match. Preserve hidden interpreter metadata, explicit host capability
boundaries, budget enforcement and snapshot identity. Do not implement boolean
failure by swallowing arbitrary guest exceptions.

Primary specification: https://tc39.es/ecma262/multipage/reflection.html#sec-reflect-object

Additional validation required: arrays, typed arrays, boxed primitives, function
objects, Maps/Sets, promises, generators, getter/setter receivers, symbol keys,
non-extensible and non-configurable targets, prototype cycles, newTarget,
malformed argument lists, SDK invocation, public and low-level snapshots, lint,
native comparisons and the real harness with screenshot inspection.

Implementation now covers all thirteen methods. The initial sixteen native
comparisons passed, then expanded coverage found shared array-length descriptor
coercion incorrectly calling host Number on guest objects. Both Reflect and
Object.defineProperty regressions reproduced this before the fix. ArraySetLength
now performs its two guest conversions and validates their results before the
native storage operation. Specification:
https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-arraysetlength

Current focused coverage includes SDK getter/construct calls, explicit newTarget,
public snapshot identities and namespace mutation, all method descriptors,
array shrinking and typed-array detachment. Native Reflect property order is
captured once rather than assuming alphabetical installation order. Broader
regression, resource-budget and low-level snapshot checks remain required.

The legacy snapshot checks caught a registration-order defect: method identities
were initially recorded as root names before the Reflect namespace existed.
Namespace identity registration now precedes intrinsic method registration.
Focused Reflect/lint/legacy checks pass: 83 tests and one optional skip.
TypeScript and focused ESLint passed. The Reflect file now passes all 42 tests,
including low-level snapshot restoration and allocation-limit rejection before
invoking apply/construct targets. The full SafeJS package suite is running,
excluding only the separate unresolved Promise-import probe.

The full run completed with 19,030 passes, 41 optional skips and three newly
added SDK regressions failing (318.77 seconds). Actual argument arrays bypassed
getter evaluation and allocation checks in the shared Function.apply shortcut.
A fourth regression reproduced the getter bug directly in low-level Function.apply.
Plain data arrays now retain synchronous invocation but are copied and budgeted;
accessor arrays use the existing guest-aware argument-list path. Sparse data
arrays preserve immediate calls through guest prototype descriptor lookup.
The first removal-only fix broke an established immediate-call test; the guarded
synchronous path preserves that contract instead of weakening the test.

The real harness passed after 70 uncached workspace tasks (59.009 seconds) and
root build suffixes; its screenshot was inspected. It uses zero agent spawns and
does not establish model behavior. The subsequent Node 18 SDK snapshot probe
failed. Reduction showed constructors were not the cause: both Object and
Reflect length definitions marked otherwise ordinary arrays as custom guest
state because the default length descriptor is non-enumerable/non-configurable.
Two snapshot regressions failed, while two readonly-length controls passed.
Guest-state detection now ignores the default writable length descriptor while
retaining readonly length as custom state. Rebuild and rerun the older-host probe
and the complete package route before delivery.

The rebuilt harness passed after 70 uncached tasks (61.213 seconds), and its
screenshot was inspected. The Node 18 built SDK probe now passes lint, coercion,
construction, explicit receivers, public snapshot restore and SDK argument getters.
A Node 24 native comparison then found an extra property on a replacement
receiver for an invalid typed-array index. The partial-object assertion had
missed extra keys; all native comparison cases now use exact deep equality.
That stronger test failed (48 controls passed) before the fix. Reflect.set now
returns true without touching a replacement receiver for invalid integer indices,
as required by TypedArray [[Set]] step 1.b.ii:
https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-integer-indexed-exotic-objects-set-p-v-receiver
The corrected 49-case run passed; added coverage also checks negative zero,
negative/fractional/nonfinite indices and detached buffers without value coercion.

The second full package run finished with 19,037 passes, 41 optional skips and
two Reflect failures (326.58 seconds). It had loaded the pre-fix implementation
while tests were strengthened. A fresh focused run confirmed the receiver fix;
the remaining mismatch was Node 22 and 24 coercing invalid-index values even with
a different receiver. The specification returns before conversion in this case,
so that regression now uses an explicit zero-conversion expectation instead of
the non-conforming native oracle. No cases or timeout checks were removed.

A further SDK/native reduction reproduced the invalid-index receiver bug when
the typed array is inherited through Object.create. Reflect.set now walks own
descriptors along the virtual prototype chain, preserving each typed-array
exotic boundary instead of flattening lookup to a descriptor. The traversal
retains step and depth budget checks. A native-comparison regression covers it.

Final focused validation: 155 tests across six files passed (4.19 seconds).
The final built SDK passes all 35 native comparison table cases on Node 24,
normalizing only transport object prototypes before strict value comparison.
Node 18 passes public snapshot restore and inherited typed-array receiver checks.
The real harness passed after 70 uncached tasks (60.439 seconds) plus root suffix
stages, and its screenshot was inspected again. Focused ESLint passed. The final
complete package rerun is pending; do not claim a full-suite pass yet.

The final maintained SafeJS package route completed successfully: 19,040 tests
passed, 41 optional tests skipped, 593 files passed and one file skipped
(315.54 seconds). The only explicit exclusion was the separate unresolved
Promise-import policy probe; it is not counted as a pass. This final run used
unchanged implementation and test sources throughout. No timeout was increased.
