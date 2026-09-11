# Intl.PluralRules validation and implementation

The built guest runtime currently has no Intl.PluralRules. Node 18 has select
but no selectRange or modern resolved rounding options. The existing private
generated plural engine provides a possible portable implementation, not a
verified public API.

## Evidence gathered before implementation

A read-only matrix against Node 22 compared 1,134 range cases across en, fr,
de, pl, ar, ru and sl, cardinal and ordinal, and nine endpoints. There were
90 differences. These are differences, not 90 validated defects.

The current ECMA-402 draft at
https://tc39.es/ecma402/#sec-resolvepluralrange explicitly returns the single
category for equal formatted endpoints. The generated backend does that;
Node 22 returns other for English cardinal selectRange(1,1). Do not change
the backend to match an older native implementation blindly.

The same draft uses ToIntlMathematicalValue for select and selectRange,
and rejects NaN in range resolution rather than all non-finite values.
The installed backend rejects both infinities and NaN. Validate exact cases
against the chosen specification, including BigInt and exact decimal input,
before implementing guest coercion. Native version behavior is not a complete
oracle for these evolving semantics.

## Required implementation and checks

- Guest constructor, metadata, strict branding, supported locales, option
  getter/conversion ordering, cardinal/ordinal selection and ranges.
- Preserve Node 18 support with private portable state, without altering host
  Intl. Reuse generated locale factories only after checking selection,
  rounding, range mapping and resolved options; do not expose backend extras.
- Cover all contemporary digit/rounding options and identify any unsupported
  draft notation semantics explicitly rather than claim full conformance.
- TDD for validated failures; freeze runtime and test changes during the
  unexcluded workspace regression so its result describes a stable worktree.
- Strict snapshot schema and reconstruction, custom properties/prototype,
  alias identity, private-state accounting and bounded formatting work.
- Focused lint/tests, maintained workspace build, built probes on supported
  Nodes, and the unexcluded workspace regression before separate delivery.

This remains one gap in the broader JavaScript completion goal. Weak
collections, host-promise import policy, dynamic functions and other missing
Intl services are not resolved by this plan.

## Implementation evidence

- 21 native-comparison cases initially failed at the missing-constructor guard.
- Shared digit-option reading was extracted from NumberFormat without changing its option sequence; private portable PluralRules backs the guest constructor.
- Snapshot retention and private-state accounting had separate failing regressions before integration.
- Invalid numeric strings such as +0x1 were accepted by the dependency. The guest boundary now validates numeric syntax and overflow/underflow before preserving exact finite decimal text.
- BigInt and exact decimal selection follow the contemporary mathematical-value semantics. Equal formatted range endpoints and unspecified CLDR range pairs intentionally need not match an older Node oracle.
- The earlier missing resolved-rounding fields and incorrect infinity guard were fixed and pushed separately before this public API work.

## Verification status

- Focused regression: 194 tests passed, one skipped, across six files covering the new constructor, NumberFormat, locale formatting, intrinsic retention and compatibility inventories.
- ESLint passed for all 13 changed implementation/test files. The maintained workspace build completed, including fresh-import checks.
- Built-package probes on Node 18.18.0 and Node 24.14.0 each matched 390 selection results across five locales, cardinal/ordinal rules and three digit-option configurations.
- The unexcluded SafeJS workspace unit process finished with source/test files frozen. Its result cache refreshed at 13:46 UTC: among 707 existing SafeJS file entries, only the exploratory weak-collection and promise-import files are marked failed. The terminal summary was not retained, so no aggregate test count is claimed from that run.
- A separate rerun of those two files confirms six unresolved failures (four missing weak-collection cases and two host-promise property-admission cases). They remain open work; this is not a green full-suite claim. Public PluralRules and its backend files are marked passed in the refreshed results.
- Backend prerequisites have published separately, most recently in safe-js 0.1.462. This plan accompanies the separate public API commit; publication must still be verified after its push.

## Remaining identified extension

The newer draft's scientific, engineering and compact notation support is not
provided by this constructor yet. The private dependency's compact path lacks
the required complete locale-formatting integration. Do not claim full draft
conformance or mark the broader JavaScript goal complete on this implementation.
