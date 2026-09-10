# Mixed-realm intrinsic snapshot identity

## Reproduction

A read-only probe against the built isolated candidate reproduced an identity
loss (2db44c). Run `return Number.prototype` twice with separate `run()` calls.
Pass both returned values as bindings `a` and `b` to the low-level serializer,
JSON round-trip the result, then restore it with that source. The values are
distinct before serialization but identical after restoration:

```json
{"distinctBefore":true,"distinctAfter":false}
```

This is distinct from the single-realm prototype-parent fix. The serializer
records installation paths such as `["Number","prototype"]`, and restoration
resolves both paths against one budget's intrinsic table. The two heap nodes
therefore resolve to the same intrinsic object. The probe did not test public
SDK admission of foreign realm values, nor establish a public API guarantee
that accepts such inputs.

## Required follow-up

- Establish which supported transport paths can contain multiple originating
  realms, including host-held guest closures and low-level heap input.
- Add regression coverage for distinct prototypes, mutations, function realm
  defaults and aliases within each realm.
- Preserve originating realm identity for supported mixed-realm transport.
  This requires realm-qualified intrinsic references and reconstruction of each
  realm's intrinsic graph, rather than creating unrelated generic objects.
- Keep source/evaluator ownership, symbol registries, budgets and resource
  cleanup explicit. The current single-source snapshot format is not evidence
  that arbitrary mixed-source closure restoration is supported.
- If a transport intentionally excludes mixed realms, enforce that boundary
  explicitly; silent identity collapse is not a valid successful round-trip.
  Such rejection would document a remaining limitation, not complete realm
  transport support.

No implementation or conformance claim accompanies this inventory item.

## Current source and public admission checks

September 9 source probe 3d3288 reconfirmed the low-level collapse on current
main: `distinctBefore: true`, `distinctAfter: false`, while a third binding
aliasing the first prototype remained aliased after restoration. This narrows
the defect to cross-realm distinction, not general within-realm alias loss.

Phase-labelled public probes (94f06a) distinguish three paths:

- Direct `bindings: {a,b}` rejects during `run`, before a dump is attempted,
  because guest function properties and prototype links cannot be serialized.
- A registered module exporting `{a,b}` rejects during `run` for the same
  reason.
- A host function returning `[a,b]` executes successfully. Guest comparisons
  report the two values distinct from each other and from local Number.prototype.
  Dumping that completed run rejects because a callable needs an explicit resume
  capability. This probe did not supply such a capability or validate recovery
  with one.

The initial combined probe bbb604 did not label the failing phase. Follow-up
54589 terminated at the first direct-binding admission rejection; 94f06a adds
per-path catches and establishes the phases above. Do not report those public
rejections as successful dumps or as reproduced public silent identity loss.

The inspected package index exposes public dump/restore but not the low-level
serialize function. `interp/intrinsics.ts` records identities by installation
path in a WeakMap and resolves them through a per-Budget map. These facts explain
the low-level collision but do not establish a supported multi-source public
checkpoint contract. Next investigate explicit host resume capabilities and
realm ownership before choosing a format change; a rejection-only patch would
not fulfill mixed-realm transport support.

## Resume-provider boundary inspection

Source inspection distinguishes two mechanisms that the earlier follow-up
wording could conflate. `RunOptions.hostCallResumeProvider` reconciles pending
external operations: `HostCallJournal` calls it with an operation identity and
validates the returned outcome proof. It is not an arbitrary object/intrinsic
identity resolver for serialization.

Replay callable identities are registered internally. `host-bridge.ts`
registers injected native functions by their binding/module paths, and
`HostCallJournal.registerCallbackFunction` registers exported guest callbacks
against a recorded host call. `encodeReplayData` asks that journal for an
existing callable identity. Its low-level `identifyCapability` callback is
not a `RunOptions` field. Additionally, the guest-state/prototype-link guard
runs before callable identification; assigning a callable identity alone does
not admit an arbitrary foreign intrinsic graph.

These are source-level boundary findings, not a successful runtime recovery
probe. Do not treat supplying `hostCallResumeProvider` as a general fix for the
earlier completed-run dump rejection. The next runtime probe should use the
actual registered callback/binding paths and distinguish admission, dump and
recovery before changing the snapshot format. The isolated full-package test
candidate remains unchanged by this documentation follow-up.

## September 10 mutation-loss reproduction

On current local code after weak snapshot integration, separate runs mutate
Number.prototype.label to `first` and `second`. Both values are passed to the
low-level serializer and restored from JSON. Probe ec201b reports distinct
values before capture, identical values afterward, and labels `["second",
"second"]`. Both intrinsic heap nodes use `["Number","prototype"]` without
an originating-realm identifier. This confirms overwritten state as well as
identity loss. An initial probe failed on an unused nonexistent import; the
corrected probe above is the runtime evidence.

The new uncommitted mixed-realm-intrinsics.test.ts exercises Number, Date and
Map constructors, their prototypes, original Object prototypes, distinct
mutations, and within-realm aliases. Initial assertion formatting invoked
native boxed-value helpers on guest prototypes; identity checks now compare
booleans to avoid those diagnostic side effects. Establish the corrected red
result before implementing a format change.

Implementation constraints from current source:

- Intrinsic identities survive close, but currently retain only an installation
  path. A budget is not a durable realm identity: it can start another realm.
- Function prototype tables already attach to function identities; active
  global-object/eval lookup and several builtin tables remain keyed by budget.
- Restoration currently initializes one intrinsic realm and one symbol
  registry. Merely adding a realm label to heap nodes will not reconstruct
  separate callable behavior or registry ownership.
- Do not use independent unaccounted budgets, clone callable wrappers pointing
  at one realm, or reject mixed input and claim transport support complete.
  Reconstruct coherent realm graphs with shared execution-budget accounting.

A separate retained dynamic-function probe successfully started a second run
with the same budget but rejected the old function invocation with compilation
owner `reentry` (18a400). It did not execute the function body, so it does not
validate the suspected wrong-global lookup. Do not change that behavior from
source inspection alone.

Corrected red run 740193 fails all three cases at the intended checks:
constructor, prototype and Object-prototype identities collapse, and the first
mutation becomes `second`. Native/pre-capture distinctions, the second label,
within-realm constructor/prototype links and repeated binding aliases pass.
The regression file remains uncommitted pending the runtime/format correction.
No implementation fix, successful new package gate or release is claimed.

## Origin identity foundation

Five new metadata regressions first failed because intrinsic registration had
no stable originating-realm identity (069240). Registration now stores the
installation path together with an opaque frozen realm token. The active
budget table owns that token and its resolution map; retained intrinsics keep
only the token, not the table, budget or other realm values. Releasing and
reusing a budget creates a new token without changing old identities. Importing
an existing intrinsic as an alias does not reassign its original token.

The new checks and existing intrinsic, budget-reuse and prototype tests pass
all 68 cases across four files (c822d1). This is the first implementation step,
not a mixed-realm snapshot fix: capture must still encode realm-qualified
identity and restore must reconstruct coherent realm graphs. The three
mixed-realm transport tests remain red and uncommitted. No independent budget
or generic-object fallback is introduced.

Focused ESLint (ab6f4e) and package TypeScript checking (b15971) pass for the
origin-identity foundation. Keep its local commit separate from the still-open
snapshot format and restoration changes.

## Shared accounting for separate realm tables

Realm lookup tables use Budget identity, while compilation owners, retained
roots and all execution limits also belonged directly to that identity. A
second independent Budget would provide an incorrect fresh allowance. The
pending Budget change separates its shared accounting state from realm-view
identity. Views have distinct intrinsic/template lookup keys but share limits,
steps, depth, data charges, retained roots, suspension state, compilation
tickets/owners and reset generation. Reset also clears template caches for
all still-live views, tracked through weak references.

The first five new contracts failed on the absent forkRealm operation
(ba0b63). After implementation, 69 budget tests passed (3ff928). A broader
eight-file selection passed 45 checks, including the unchanged camera file,
but one new assertion incorrectly expected primitive Number conversion to
visit a node (bb94c3). That assertion was replaced with a real Array constructor
allocation-limit check; the cumulative step test remains intact. The corrected
five-file selection passes 68 tests (f975ec). Node 18.20.8 passes 55 tests across
the four selected budget files (e23715), before the additional template-reset
case. Earlier TypeScript and lint checks pass; final checks are pending.

This does not implement the mixed-realm snapshot format yet. The three
mixed-realm regression cases remain unresolved. No new full-package pass,
remote delivery or release is claimed.

The final Node 22 realm-view/template selection passes 20 tests across two
files, followed by successful package TypeScript checking (a59a3a). Final
focused ESLint also passes (20bda0). The template regression confirms that a
reset through a child view clears all three views' cached source-site objects
and shared retained roots, rather than only clearing the caller's cache.
The same final 20-test selection passes on Node 18.20.8 (e4f9e9).

## Realm-qualified capture and restoration candidate

Mixed captures now assign positive realm IDs to intrinsic nodes from distinct
origin tokens. Single-origin captures omit the field to preserve the legacy
shape. Validation rejects malformed IDs. Restoration initializes each numbered
realm through its own shared-accounting Budget view and keeps symbol-registry
consistency checks scoped to the corresponding originating sandbox realm.
Default, unnumbered snapshots retain the existing primary-budget route.

The original three mixed-realm regressions and 46 existing prototype checks
pass (2cc423). Stronger constructor invocation then exposed a separate Map
instance-origin defect (073b00). Direct Map/Set controls reproduced it outside
snapshot restoration; its independent correction and qualification are in
safejs-collection-instance-origin.md.

The expanded mixed-realm file passes five cases (5f0602): independent Number,
Date and Map constructor/prototype graphs, mutations, aliases, actual instance
construction, a second capture/restore cycle, legacy single-realm shape,
malformed IDs and distinct sandbox symbol registries. Post-hydration failure
injection confirms that created foreign-realm roots are released and compile
ownership is available afterward. An initial dataSize=1 setup rejected input
before hydration and therefore did not establish rollback coverage; the final
test injects failure at final compiled-value reconciliation instead.

The full snapshot directory is running in session 94536 on unchanged candidate
source/tests. Await its terminal result. This candidate is not yet committed,
and no package-wide conformance or publication claim follows from five cases.
Arbitrary mixed-source interpreted closures still require separate ownership
and source-format work; this change reconstructs intrinsic realm graphs.

The five mixed-realm cases also pass on Node 18.20.8 (88a248). Final package
TypeScript checking passes (35534d), as does focused lint after the rollback
test correction (0efddc).

A read-only current-source probe (47dc55) additionally preserves separate
constructors, prototypes, Object prototypes, mutations and within-realm links
for 17 families: Object, Array, Boolean, String, RegExp, Set, WeakMap, WeakSet,
WeakRef, FinalizationRegistry, ArrayBuffer, SharedArrayBuffer, DataView,
Uint8Array, Intl.Collator, Temporal.Instant and Temporal.Duration. This probe
does not claim constructor invocation coverage for all 17 families.

Full snapshot session 94536 completed successfully: 2,087 tests across 154
files passed in 108.33 seconds (6ff8f3). No source or test edits were made
during that run; only documentation and the independent collection commit
changed. This qualifies the intrinsic-graph correction, not arbitrary
mixed-source interpreted closures or the still-failing full package gate.
