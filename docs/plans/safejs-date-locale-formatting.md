---
title: Date locale formatting
---

## Validated gap

Three initial native-oracle failures show missing toLocaleString,
toLocaleDateString and toLocaleTimeString methods. Expanded checks had 37 failures
and 10 passes before implementation. The old test explicitly expected these
methods to be absent; retain its native-constructor isolation checks while
replacing that obsolete absence expectation with real formatting coverage.

## Implementation

Follow ECMA-402's Date locale methods and CreateDateTimeFormat algorithm:

- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/locale-sensitive-functions.html
- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/datetimeformat.html
- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/negotiation.html

Capture the branded Date's time before reading arguments. Invalid dates return
Invalid Date without inspecting locales or options. Canonicalize locale lists
incrementally, preserving holes, inherited properties, getter effects and errors.
Read/coerce/validate formatting options once in specified order, through the guest
property and coercion mechanisms. Only canonical locale strings and primitive
options cross into the captured native ICU formatter; no guest object or callback
is handed to native Intl. Apply the distinct date/time/all default components and
style restrictions. Preserve intrinsic metadata, subclass behavior and replay.

Bound sparse lists, coercion, retained intermediate values and output length with
the normal budget routes. Native calendar/numbering resolution and formatting
remain locale-data dependent, as in JavaScript. Unsupported Intl constructors and
broader locale-sensitive methods remain separate gaps, not solved by this change.

## Validation and delivery

Use explicit locales and time zones for deterministic native comparisons. Check
all option getter order, inheritance, coercion hints, early validation failures,
error identity, invalid-date early return, alias-free function metadata, styles,
calendar/numbering options, fractional seconds, offset time zones, Date mutation
during argument processing, subclasses, pending/completed replay and budgets.

Run focused Date tests and the full maintained SafeJS suite, explicitly excluding
the unresolved native Promise import-policy file and the separately validated,
uncommitted String.localeCompare guest-option probes. Run scoped lint, types,
selected workspace build and the actual harness below; inspect its screenshot.
Commit and push this improvement separately and monitor publication without
waiting to investigate the next validated gap.

The first full run passed 17,095 tests with 41 skips but retained an obsolete
version of the output-budget assertion collected before it was corrected. That
assertion confused the string-length limit with retained-data accounting; its
corrected stringLength check passes. The final focused Date cohort passes 249
tests across seven files, including a subsequently reproduced and corrected
typed-array locale-entry rejection case. Rerun the maintained suite against this
stable version rather than count the earlier failed run as green.

The clean maintained-suite rerun passed 17,097 tests with 41 skips across 497
passing files and one skipped file in 224.08 seconds. Both explicit exclusions
are uncommitted follow-up issue probes (native Promise import policy and guest
localeCompare options). Scoped lint and package types passed. The next expanded
localeCompare probes have 13 failures and one pass; none are counted as fixed.

Remove the README's obsolete unsupported-Date paragraph, which incorrectly lists
locale methods and several already delivered Date features as absent. No new
README content is added. Native-constructor isolation remains explicitly tested.

The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The actual harness passed and its PNG was visually inspected after
the screenshot runner completed 70 uncached build tasks in 61.179 seconds.
