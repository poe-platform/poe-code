---
title: String localeCompare guest options
---

## Validated next issue

Three initial native-oracle failures establish ignored inherited numeric options,
rejected guest option getters, and failed guest string conversion through a
managed prototype. The expanded 14-case file has 13 failures and one pass before
implementation. It also covers callable comparison values, locale-list getters,
receiver/comparison/locale/options ordering, exception identity, symbol rejection,
pending/completed replay and fatal coercion budgets.

The current string method uses deepCopyFromSandbox for comparison/locales and
own data descriptors for options. This is a host-admission policy accidentally
applied to guest JavaScript operations. Preserve the actual public copy boundary
and the low-level tests that reject raw native accessor callbacks; those are
distinct from legitimate guest accessor execution.

## Next implementation

Use guest ToString for the comparison value and the shared guest locale-list
normalization introduced for Date formatting. Extract only the actually shared
locale/property/option operations when both consumers need them. Read Collator
options in ECMA-402 order: usage, localeMatcher, collation, numeric, caseFirst,
sensitivity, ignorePunctuation. Validate/coerce each before reading the next.
Pass only canonical strings and primitive options to native ICU. Preserve normal
budget charging and retained intermediates. Keep the maintained low-level raw
native input rejection behavior without weakening host admission.

Primary specification:
https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/collator.html

Run the maintained localeCompare cohorts, generic string-receiver tests, Date
locale tests after shared extraction, lint/types, selected workspace build and
an actual screenshot-inspected harness pair. Commit this issue independently of
Date locale formatting; monitor release publication without blocking progress.

## Implementation and verification

The guest-execution branch uses shared Intl option/property/coercion helpers;
the existing low-level native-input route is unchanged. Canonical locale lists
retain hole/inherited-index behavior and reject typed-array numeric entries.
Only canonical strings and primitive options reach native collation. Preserve
native error class/message compatibility by delegating known-invalid primitive
values to native validation, without repeating guest property reads or coercion.

The initial new-Date/new-collation cohort passed 78 tests. The maintained cohort
then caught 15 native-message regressions; those were corrected without changing
the existing assertions. All 462 tests across six maintained files then passed.
Expand this with exact option order, early errors, guest exception identity,
ignored extra arguments and sparse-list budget coverage before final checks.

Existing primitive-input native-message assertions remain unchanged. New guest
object tests assert specified coercion order and error class, not V8's optional
internal object preview in diagnostics; invalid guest options report the already
converted value without handing guest objects to native error formatting.

The final scoped cohort passes 472 tests across six files, covering both shared
Intl consumers, generic string receivers, native diagnostics and raw-host input
restrictions. Scoped lint and package types pass. Use these focused maintained
checks for this API-local change; do not claim a new full-suite run. The separate
native Promise import-policy tests remain unresolved.

The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The actual harness passed and its PNG was visually inspected after
70 uncached screenshot-runner build tasks in 61.209 seconds. Separate locale
case-mapping probes are the next issue and are not part of this delivery.
