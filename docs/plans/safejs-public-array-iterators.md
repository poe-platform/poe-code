---
title: Public Array iterator cursors and snapshots
---

# Public Array iterators

The initial maintained regression file `array-iterators.test.ts` has 12 failing
native-oracle cases on the Array-species implementation. It was created and run
after that change's full suite completed, and is not included in its passing
test count or commit.

Expose Array.prototype.values, keys, entries and the values alias at
Symbol.iterator. Iterators must retain their receiver and cursor privately,
observe live length and element writes, yield undefined for holes, skip element
reads for keys, release the source on exhaustion, and remain exhausted after
later source growth. Generic receivers, primitive boxing, brand checks, fresh
entry pairs, metadata and iterator identity must match JavaScript.

Integrate memory accounting, native/guest copy boundaries, intrinsic prototype
identity and portable snapshots. Existing implicit for-of cursors are not public
iterator objects; collection/regexp iterators provide examples of explicit
snapshot state. Do not expose implementation fields or let guest property writes
corrupt cursor state. Validate abrupt getters and pending/completed replay.

Primary specification:
https://tc39.es/ecma262/2026/multipage/indexed-collections.html.

Implementation uses private WeakMap cursor state and guest intrinsic prototypes,
not enumerable implementation fields. Portable guest heap nodes capture source,
index, mode and complete public object descriptors/prototype. Snapshot validation
rejects execution-scope sources. Memory/depth accounting follows the hidden source
and exhaustion releases it; host-data export rejects the live cursor explicitly.

The expanded focused suite has 25 passing tests. It covers live mutation,
exhaustion, typed arrays, generic and primitive receivers, getter failures,
re-entrant length reads, protected state after freezing/public-property writes,
portable cursor restoration, completed replay, pending-effect replay, memory
retention, host boundaries and forged snapshot sources. A five-file regression
cohort passed 156 tests before the final validation/replay additions.

Node 22 differs from the published specification for generic length getters
after exhaustion: it performs an extra read. The explicit spec-based test expects
no such read, following section 23.1.5.2.1 steps 5 and 10. Cursor index is captured
before invoking the length getter, so re-entrant next calls preserve spec order.
Typed-array iteration uses internal length, not an overridden public getter.

Intrinsic installation must not consume guest execution steps; a two-step
`return 1` regression reproduced and guards against accidental bootstrap charges.

A fresh-process native ESM probe exposed an initialization cycle hidden by the
Vitest loader: graph-depth imported iterator state, which imported execution
coercion and reached snapshot validation before MAX_DATA_DEPTH initialized.
Iterator branding/state now has type-only dependencies; next execution lives in
the methods module, matching the separation used by existing iterator families.
The fresh-process probe now succeeds. The first full-suite run was deliberately
terminated for this correction and is not counted as passing validation; a
clean full run was started after the module split. Lint and TypeScript passed.

That full run reported three failures (17,364 passes, 41 skips): native allocation
traversal attempted to invoke the guest iterator on Array.prototype, and two
legacy interpreter restore tests supplied built-ins installed under a different
budget than their evaluation context. Indexed allocation traversal now avoids
the guest protocol. Iterator acquisition preserves the legacy implicit-array
bridge only for a known default intrinsic missing from the caller context.

An additional failing control established that deleting the installed default
iterator must disable iteration, not revive implicit fallback. This is now
handled separately from the legacy cross-budget bridge. The strengthened
iterator/locale/interpreter cohort passed 540 tests across three files; the
iterator file now has 27 tests. A fresh complete package run follows these fixes.

Remaining family-level gaps were checked separately: SafeJS reports undefined
for Iterator and Array.fromAsync, while Node 22 exposes both as functions.
Native array iterators inherit Iterator helper methods and an Iterator constructor;
those shared Iterator APIs are not implemented by this cursor change. Keep them
in the completion inventory, rather than describing this as full Iterator-family
conformance. Generator public-property corruption is another validated next task.

Clean full qualification passed: 17,369 tests, 41 declared skips, 505 passing
files and one skipped file in 235.88 seconds. The only explicit exclusion was
the unresolved native-Promise own-property import-policy file. The interrupted
run and the three-failure integration run above are not counted as passes.

Selected workspace build passed 23 dependency-closure builds and four native ESM
import smoke tests. The actual harness pair passed; its screenshot was viewed.
The screenshot runner completed 70 uncached root build tasks. No matching open
GitHub Array-iterator issue was found to close.
