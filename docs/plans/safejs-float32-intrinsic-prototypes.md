---
title: Float32Array intrinsic prototypes
---

# Validate Float32Array intrinsic prototype gaps

The next language-completeness investigation checks the exposed Float32Array
constructor and prototype graph: prototype identity, constructor linkage,
BYTES_PER_ELEMENT, detached instances, ordinary instanceof behavior, and
subclass construction. Each probe compares against an isolated native JavaScript
realm. Keep normal construction and iteration as a passing control.

Validate failures before changing implementation. Typed-array indexed storage,
buffer ownership, numeric descriptors, iteration, cloning, snapshots and budget
measurement must stay intact. This is separate from adding the other typed-array
constructors or opening arbitrary host capabilities. Do not claim those broader
gaps are fixed by a Float32Array prototype improvement.

Initial validation: six native-oracle cases failed and the ordinary construction/
iteration control passed. The current constructor has no prototype, its instance
prototype does not match, prototype detachment is rejected, fake-prototype
instanceof cannot be constructed, and subclass inheritance rejects the missing
prototype. Log: `/tmp/poe-safejs-float32-intrinsic-prototypes-red.log`. No
implementation changes have been made for this task yet.

## Expanded validation and first implementation step

The expanded 21-case native-oracle suite exposed 18 failures and retained three
passing controls. It also checks the shared TypedArray constructor/prototype,
readonly BYTES_PER_ELEMENT descriptors, stable method identity, metadata getters,
deleted/overridden methods, subclass getters, iterator methods and overrides,
and detached-instance behavior. Log:
`/tmp/poe-safejs-float32-prototypes-expanded-red.log`.

Additional failing tests validated custom prototype links and integer-indexed
lookup through a typed array used as another object's prototype. Native lookup
must stop at the typed array for canonical numeric strings such as `-0` or `NaN`,
even if an ancestor has such a property. Both ordinary descriptor lookup and the
data-only helper were separately reproduced returning the wrong ancestor value.

The initial implementation is limited to object-model support: recognize native
Float32Array storage as a supported sandbox prototype participant, preserve the
legacy null default until the intrinsic factory is installed, and stop numeric
lookup at each typed array in the prototype chain. Actual native storage and
physical host prototypes remain unchanged. These are unfinished local changes,
not a delivered prototype graph.

Current focused result: 34 passes and 18 expected pending failures (25 prototype
tests plus all 27 maintained Float32Array tests). Scoped lint passed; TypeScript
passed before the final data-only lookup addition. Logs:
`/tmp/poe-safejs-float32-prototypes-links-final.log`,
`/tmp/poe-safejs-float32-inherited-index-red.log`,
`/tmp/poe-safejs-float32-data-index-red.log`.

## Remaining integration

Install a per-budget Float32Array and shared TypedArray prototype/constructor
graph after Function/Array initialization; preserve older constructor snapshot
shapes. Route metadata and stable methods through ordinary sandbox descriptor
lookup, keep integer-indexed reads/writes distinct, honor iterator overrides and
method deletion, and select/retain newTarget.prototype during construction.
The existing Array iterator machinery already understands Float32 storage and
can supply iterator state without exposing native iterator objects.

Snapshot serialization currently writes storage plus enumerable data entries;
it must preserve explicit prototype links and descriptor state without eagerly
materializing descriptors for every numeric element. Review copy/replay boundary
guards, symbol metadata, byte-buffer aliasing and memory accounting. Preserve the
camera fixture and its unchanged timeout; no builds concurrent with tests.
Other typed-array constructors, buffer APIs, missing methods and full species/
input-coercion semantics remain broader work, not silently completed by this task.

## Constructor/prototype implementation and snapshot checks

The per-budget Float32Array and shared TypedArray graph is now implemented
locally. Float32Array construction selects the newTarget prototype and retains it
through allocation. Metadata uses sandbox getter descriptors; existing methods
have stable identities. Iterator methods use the existing Array iterator state
with typed-array receiver validation, and protocol lookup respects custom
Symbol.iterator values and detached instances. The existing generator adapter
was generalized for data-only callers that still need guest protocol execution.

Runtime metadata measurement accepts symbols/accessors without weakening the
separate strict Float32 data-copy validation. A maintained test caught the
original symbol-before-accessor rejection order changing; that order was restored.
New native-oracle tests exposed missing join, tag metadata and inherited readonly
BYTES_PER_ELEMENT enforcement; those paths were added. The resulting runtime/
metadata cohort passed all 60 tests.

Four new portable-snapshot tests then failed before implementation: subclass and
null prototype state, custom iterator-symbol state, and the older constructor
shape. Float32 snapshots now carry separate metadata descriptors and optional
prototype links beside byte storage, restoring metadata through a temporary
object rather than enumerating numeric element descriptors. Realm bootstrap
preserves older constructor snapshots. The subsequent snapshot/runtime cohort
passed all 60 tests; TypeScript passed. Logs:
`/tmp/poe-safejs-float32-prototype-snapshots-red.log`,
`/tmp/poe-safejs-float32-snapshots-focused.log`,
`/tmp/poe-safejs-float32-snapshots-types.log`.

The first full SafeJS suite is running. The implementation is not qualified,
committed or pushed yet. Review join against overridden subclass length, malformed
snapshot metadata, retention and resnapshotting after this run; focused successes
alone do not prove those contracts.

## Qualification follow-up

The first full run finished with 17,651 passing tests, 41 skips and four failures.
All four failures demonstrated intrinsic installation consuming guest step budget;
bootstrap prototype links now install without charging guest execution. Subsequent
native probes also validated join's internal-storage length (even when a subclass
overrides public length), separator coercion, subclass fields, own accessors and
numeric property definition. The focused seven-file cohort passed 138 tests and
TypeScript passed.

Portable snapshot coverage now includes two consecutive restore cycles for own
accessors and subclass fields, plus shared-buffer aliasing, custom iterator
symbols, self references and malformed metadata rejection. These checks passed.
A new spy-based regression reproduced descriptor-state inspection materializing
every typed-array numeric descriptor after Object.defineProperty. That inspection
now selects metadata descriptors only; the two-file follow-up passed all 17 tests.
TypeScript passed again. The full SafeJS suite is running against these changes,
with only the separate unresolved two-case host-Promise import policy audit
excluded. Log: `/tmp/poe-safejs-float32-final-package.log`.

No Float32 commit, remote delivery or release is claimed yet. Selected workspace
build, actual harness execution and screenshot inspection remain required after
the full suite succeeds.

The follow-up full run completed in 246.43 seconds with 17,668 passes, 41 skips
and one obsolete expectation: `classes.test.ts` still required a TypeError for
public fields on a constructor-returned Float32Array. An isolated native realm
confirmed successful field definition with writable/enumerable/configurable
descriptors. The test now compares storage and field descriptors against that
native oracle instead of requiring the former limitation. A final full rerun is
in progress at `/tmp/poe-safejs-float32-qualified-package.log`; runtime source
remains unchanged from the preceding full run. Scoped implementation lint passed.

## Qualified delivery

The final full SafeJS rerun passed 17,669 tests with 41 skips (517 passing files,
one skipped), in 242.52 seconds. Only the separate two-case host-Promise import
policy audit was excluded. Scoped ESLint and TypeScript checks passed. The selected
SafeJS build passed its 23-workspace dependency closure and all four native-ESM
checks. The actual harness pair passed after the CLI's 70 uncached build tasks
(61.384 seconds). Its screenshot was opened and visually verified:
`screenshots/harness-run-docs-plans-safejs-float32-intrinsic-prototypes.md.png`.

The open GitHub issue search found no matching Float32 issue to close. This
atomic improvement is ready for commit and remote-main delivery; publication
must be checked independently after push. Other typed arrays, buffer APIs,
factories, input coercion and species behavior remain separate incomplete work.
