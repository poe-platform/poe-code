# JavaScript gap audit

## Current built-runtime evidence

This inventory was rechecked after remote-main commit
04b1bbd258fcd90d0b7611df55eb1e5b3e78cf1d. The local build also contains
uncommitted dynamic Function constructors and weak collections. Presence in this
build is not proof of remote delivery or full conformance.

A clean Node 24.14.0 VM global-name comparison reports these absent guest names:
Atomics, Proxy, FinalizationRegistry, WeakRef, eval, SharedArrayBuffer,
and WebAssembly. WebAssembly is a separate platform API. This is an omission
inventory, not an exhaustive list of semantic gaps.

| Area | Current evidence | Remaining work |
| --- | --- | --- |
| Function / eval | Function-family constructors work in the local uncommitted runtime; eval remains absent | Finish broad runtime verification and delivery; implement direct/indirect eval scope rules, budgets and snapshots |
| Proxy | Missing binding | Traps, invariants, receiver behavior, metering and continuations |
| SharedArrayBuffer / Atomics | Missing bindings | Shared-memory ownership and scheduling semantics |
| WeakRef / FinalizationRegistry | Missing bindings | Reachability and cleanup scheduling with sandbox resource control |
| WeakMap / WeakSet | Local tests pass on Node 22; built Node 18 rejects valid symbol keys at WeakRef construction | Portable symbol lifetime semantics; feature remains uncommitted |
| RegExp.compile | Delivered in 713e15dc9 and published in SafeJS 0.1.475; 415 regressions and Node 18/24 comparisons and replay pass | Continue semantic auditing |
| RegExp legacy statics | Native constructor names absent in built guest | Validate matching-state behavior before implementation |
| Error diagnostic APIs | Native captureStackTrace, prepareStackTrace, stackTraceLimit absent | These are V8-specific APIs, not proof of a core-language omission |

The RegExp static-name comparison reports input, $_, lastMatch, $&, lastParen,
$+, leftContext, rightContext, their punctuation aliases, and $1 through $9.
Checking names does not establish the intended semantics or authorize importing
native global match state.

## Delivered capabilities that older notes incorrectly listed as missing

The built Intl namespace contains Locale, Collator, NumberFormat, ListFormat,
RelativeTimeFormat, DisplayNames, DateTimeFormat, PluralRules, Segmenter,
DurationFormat, getCanonicalLocales, and supportedValuesOf. All were delivered
by the verified SafeJS 0.1.470 publication. Presence and regression coverage do
not establish complete Intl conformance across locales and host ICU versions.

Other verified remote-main changes include:

- globalThis, dynamic import of registered modules, and guest host-function
  property mutation, delivered in earlier commits.
- Legacy escape/unescape, delivered in e520de3f8.
- Thirteen legacy String HTML methods, delivered in 7587264c1 and published
  in SafeJS 0.1.471.
- Symbol-accessor snapshot state, delivered in ac0a0036e and published in
  SafeJS 0.1.472.
- Four legacy Object accessor methods, delivered in 108c3a6fd.
- Guest __proto__ accessors, delivered in 314bb3455. The cumulative SafeJS
  0.1.473 publication includes the preceding Object accessor methods.
- Object property-key conversion order, delivered in 52df4a2ad and published
  in SafeJS 0.1.474.
- Dynamic Function source grammar, delivered in db72de23d; strict identifier
  deletion in 5fb116b1c and static-import rejection in 0be58fe27 are also delivered.
  These parser changes do not deliver the uncommitted runtime constructors.
- Value-expression deletion, delivered in b400fda35 and published in SafeJS
  0.1.485. Primitive-property deletion is verified on remote main in 04b1bbd25;
  its scoped release run 34258998616 failed. Inspection exposed misplaced
  partial-staging insertions in both deletion commits. The exact committed-code
  repair is documented in safejs-delete-delivery-repair.md; publication of the
  earlier version is not proof of the intended deletion semantics.

A new native prototype-name comparison no longer reports the String HTML,
Object legacy accessor, __proto__, or RegExp.compile omissions. RegExp.compile
is verified on remote main and published as noted above.

## Open semantic and operational investigations

- Weak-symbol storage cannot be polyfilled by silently keeping a permanent
  strong-symbol table. Node 18 exposes no V8 weak-symbol feature flag in its
  option listing. Do not raise the declared Node minimum without authorization.
- Host Promise own-property import has unresolved admission-policy implications.
  Do not import private AsyncLocalStorage metadata or classify every omitted
  host capability as missing JavaScript.
- The camera fixture has reproduced CI timeouts. Earlier performance experiments
  and exact fixture/budget constraints remain in safejs-camera-ci-performance.md.
  Do not relax timeouts or shrink fixtures to claim success.
- Dynamic Function/eval design constraints remain in safejs-dynamic-functions.md.
- The earlier full runtime suite reported 68 failures. Focused fixes address
  intrinsic initialization accounting, implicit async prototypes, circular
  source-metadata imports and outdated constructor-absence assertions. Snapshot
  and accounting coverage passes 1,491 tests. The maintained full rerun finishes
  with 21,662 passes, eight failures and 37 skips: camera and D3 timing failures,
  snapshot-corpus timing, three modeled-error proof timeouts and two unresolved
  host-promise property-import tests. Runtime delivery remains incomplete.
- Older Intl investigations include Node 18 offset-timezone support and draft
  PluralRules notation options; revalidate concrete behavior before changing code.

## Completion and delivery boundaries

The overall four-day JavaScript-completeness objective remains open. These
inventories do not redefine it around the capabilities already implemented.
Further differential, resource-accounting, host-boundary, and snapshot testing
is required even for APIs whose names are present.

Each atomic improvement is committed and pushed independently. Local commit,
verified remote-main delivery, and successful publication are separate facts.
Workflow concurrency can cancel superseded runs; a trigger is not proof that
that commit received a distinct version. Monitor cumulative publication while
continuing validated issue work.

Do not treat process, require, Buffer, browser APIs, or network access as missing
core JavaScript capabilities. Do not expose them implicitly while adding a
language feature.
