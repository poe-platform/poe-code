# Intl.RelativeTimeFormat

The current public runtime built from ListFormat 71f8173a7 reports undefined for
RelativeTimeFormat, DateTimeFormat, DisplayNames, DurationFormat, PluralRules and
Segmenter. Collator, Locale, NumberFormat and ListFormat are now present; this
does not prove full conformance or close the broader JavaScript goal.

Add native differential tests before implementation, covering constructor-only
use, prototypes, locale and option ordering, supported locales, all units and
styles, numeric:auto, parts, negative zero, finite numeric validation, BigInt and
Symbol rejection and observable value/unit coercion. Use sandboxNumber and
sandboxString; do not expose native objects or execute guest coercion in host
Intl methods. Preserve Node 18 support.

Store native formatter state privately and add strict serialized options,
snapshot identity/custom-state restoration and memory accounting. Test forged
snapshots, public replay and resource bounds. Verify focused tests, maintained
build/lint, public built runtime on supported Nodes and broader workspace tests
before an atomic commit and push. Monitor publication while continuing work.

Existing weak-collection and host-promise admission gaps remain unresolved; no
assertions in those tests are changed or excluded by this work. The preceding
bundle fix and ListFormat release workflows are running separately.

## Verification

- All 18 initial native differential cases failed on the missing API before
  implementation, then passed.
- Seven subsequent accounting/snapshot tests failed before private-state
  integration and passed after it.
- Focused implementation plus adjacent ListFormat and unchanged legacy graph
  fixtures: 105 passed, one existing skipped case. The two legacy intrinsic
  maps explicitly include RelativeTimeFormat; their comparison helper and
  saved fixtures were not weakened or regenerated.
- Maintained selected workspace build: 23 dependency-closure builds passed,
  including four fresh-process SafeJS export import checks.
- ESLint passed across all ten changed TypeScript files.
- Built native differential matrix: 1,728 comparisons each on Node 18.18.0
  and Node 24.14.0, across six locales, three styles, both numeric settings,
  six numbers including negative zero, and all eight units.
- Built public pending/completed replay passed on both versions. The initial
  ad-hoc assertion incorrectly rejected the API's additional snapshot/stats
  fields; correcting that probe to assert ok and the complete return value
  required no runtime change.
- Unexcluded workspace unit run finished in 515.43 seconds: 20,529 passed,
  37 skipped and six failures in the four weak-collection and two host-promise
  import gap tests. No RelativeTimeFormat failure or timeout occurred. This
  is not a green full suite; the broader gaps remain open and unchanged.
- Nine additional built adversarial differential probes passed for prototype
  lookup, option and value/unit abrupt completion, receiver branding, primitive
  options, non-finite values and independent resolved-option objects.

The preceding ListFormat commit published as @poe-platform/safe-js@0.1.452.
