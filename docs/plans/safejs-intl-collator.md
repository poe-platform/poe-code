# Intl.Collator implementation work

## Validated gap

The built runtime on September 8 reports undefined for Intl.Collator, as well as
DateTimeFormat, DisplayNames, DurationFormat, ListFormat, NumberFormat, PluralRules,
RelativeTimeFormat and Segmenter. Locale is being implemented separately. These
remaining constructors are still part of the compatibility objective.

Existing string localeCompare already converts guest locales and options before
using native ICU. Reuse its maintained option declarations/coercion logic instead
of introducing an independent, drifting option parser.

## Required behavior

Follow the current [Collator constructor](https://402.ecma-international.org/#sec-intl.collator)
and [bound comparison function](https://402.ecma-international.org/#sec-intl.collator.prototype.compare).

- Both call and construct create a new Collator; derive the prototype before
  locale-list coercion. Preserve getter order and immediate option validation.
- Only converted locale strings and primitive option records enter ICU. Keep
  native Collator objects private; never expose native methods or accessors.
- supportedLocalesOf canonicalizes guest locale lists and converts its options.
- resolvedOptions returns a fresh ordinary object in the standard property order.
- compare is an accessor returning one stable bound guest function per instance.
  Its name is empty and length is two; it is nonconstructible, ignores its call
  receiver, and converts the first argument before the second.
- Brand checks reject forged receivers even when they inherit the real prototype.
- Preserve constructor/method descriptors, derived construction, guest mutation,
  standard tag and function/prototype identities under Intl.
- Meter private primitive state, comparison strings and outputs. Retaining the
  bound comparison function must also retain its owning Collator state.
- Snapshots preserve private state plus descriptors, cycles and custom prototypes.
  The stable bound comparison needs a dedicated owner relationship, not a native
  function or a closure with no reconstructible origin. Validate malformed nodes.

## Delivery sequence

After Locale is verified and independently pushed, add failing Collator tests;
then implement the constructor, methods and snapshot integration together. Run
focused tests, maintained build, lint, supported-Node probes, broad SafeJS and
downstream checks. Commit and push this atomic API separately. No matching open
Intl GitHub issue was present in the September 8 query; do not invent a closure.

Locale's in-progress full regression run must not be mutated by starting these
runtime/test changes early. This document records read-only preparation while
that run and prior release workflows continue.

## Read-only design validation during the accounting gate

Current ECMA-402 ResolveOptions and Collator's ResolutionOptionDescriptors confirm
the existing string-locale declaration order: usage, localeMatcher, collation,
numeric, caseFirst, sensitivity, ignorePunctuation. Reuse that declaration and
conversion path. supportedLocalesOf reads only localeMatcher after canonicalizing
the locale list; it must not read constructor-only option getters.

The existing createBoundFunction and bound-function heap node already retain and
restore a target, bound receiver, arguments, name, length, guest descriptors and
aliases. Investigate reusing those for compare with an internal intrinsic target,
the owning Collator as receiver, an empty name, length two and no construct hook.
That can avoid introducing a separate callable heap kind if observable tests
confirm native behavior for call/apply/bind, Function.prototype.toString,
constructibility, own keys and repeated getter identity. The internal target
must have a stable private intrinsic identity, not be exposed as a new Intl API.

The owning Collator still needs private, metered state and a dedicated heap node.
Its snapshot must preserve the cached compare function reference so getter identity
survives restore. Preserve actual resolved locale/options rather than reapplying
ambient defaults on resume; validate that serialized options are data-only and
well formed before creating native ICU state. Do not serialize native functions
or native Collator objects.

No Collator runtime or test edits were made during the active accounting suite.

## Initial TDD baseline

The accounting fix completed its 20,332-test broad gate and is now verified on
remote main as 18bd223ecdcff10876be97d004c9f37076009db6. Its scoped release
34214636813 and CLI release 34214636979 have started; no publication is verified.

After that delivery, added intl-collator.test.ts. Run 98701 finished with 18
failures and five coincident TypeError passes in 23 cases. Those five passes do
not demonstrate Collator support. Tests cover call/new, inheritance, numeric
sorting, stable bound comparison identity/metadata, descriptors, coercion order,
fresh resolved options, supportedLocalesOf option access, forged receivers and
repeated snapshots of a compare/owner cycle. No runtime implementation yet.

## Local implementation and validation

Added private Collator state holding primitive resolved options plus private ICU
state. The guest instance is an ordinary branded object; native objects/functions
never cross into guest values. Private options and cached comparison functions
participate in memory measurement. Constructor and supportedLocalesOf convert
guest arguments before ICU, preserving ordering and immediate validation.

The compare getter caches an existing SafeJS bound-function wrapper around the
private %CollatorCompare% intrinsic. Its owner, empty name, length two, descriptors
and aliases use the maintained bound-function snapshot machinery. A guest-collator
heap node preserves resolved options and the cached function reference. Validation
checks complete typed options and rejects cached comparisons owned by another
instance or bound to an unexpected intrinsic. Custom prototypes and repeated
low-level/public replay are covered.

Shared readCollatorOptions now owns the existing localeCompare option declaration
and conversion. Initial refactoring changed native localeCompare diagnostic text;
eight existing tests caught it. The consumer-specific diagnostic callback restores
those messages without duplicating conversion logic. Run 66079 then passed all
167 Collator/string-locale tests. A prototype control originally referred to the
still-missing global Function; it now compares against an existing function's
prototype, testing the same prototype relationship without that separate gap.

Expanded Collator coverage has 36 tests, including Locale input brand handling,
derived construction order, malformed collation ordering, comparison/output
budgets, private-state accounting, forged snapshots and custom prototypes.
Run 7023 passed 171 tests with one existing skip across Collator, Locale, Intl,
both legacy checkpoint suites and shared intrinsic retention. The two legacy
expected builtin catalogues explicitly include Collator; historical fixtures,
hashes and graph assertions remain unchanged.

Build 78407 passed all 23 selected workspace builds and four fresh native imports.
Runtime lint 2677 and final test lint 9864 passed. Built Node 18.18.0 and 24.14.0
probes each matched 20 native Collator cases across en/de/sv/zh/und and option
combinations. No runtime Node minimum changed.

Full SafeJS run 74446 is active with source/tests frozen; log:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-collator.SY4yRLO71D`.
Only the same two historical experimental files are excluded, not the new tests.
Downstream run 23106 is active. No Collator commit or push yet.

The prior shared-accounting scoped release 34214636813 published SafeJS 0.1.448
at 2026-09-08T10:21:13.2586846Z. CLI 34214636979 remains active; older Locale CLI
34213392646 was cancelled after main advanced. Neither is a verified CLI
publication. Continue monitoring without blocking the next implementation.

Downstream run 23106 completed successfully: 163 tests in 13 files, 24.50 s.
Full run 74446 remains active; keep its source and tests unchanged until terminal.

## Completed pre-push gate

Run 74446 completed with exit zero: 20,368 passed, 37 existing skips, 687 passed
files and one skipped file in 424.50 s. Only the two previously documented
experimental files were excluded. The three camera cases passed in 3,879, 2,530
and 2,402 ms. No runtime or test edits were made during the run.

Downstream, focused tests, maintained build, lint and Node 18/24 differential
checks above are also green. A fresh fetch confirmed local HEAD and remote main
both at 18bd223 before this atomic Collator commit. Prior scoped publication is
verified as 0.1.448; its CLI workflow is still running, not a completed release.
