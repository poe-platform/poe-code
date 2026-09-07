---
title: Locale-sensitive string case conversion
---

## Validated gap

Two native-oracle failures establish missing toLocaleLowerCase and
toLocaleUpperCase. Expanded pre-implementation tests had 26 failures and six
passes. Register both methods through the maintained String method declarations,
with their native names, zero length, ordinary guest function properties, and
normal non-null receiver/ToString handling.

Reuse guest locale-list canonicalization, charge mapping work before native
conversion and bound the returned string. Pass only the receiver string and
canonical locale strings into native locale-sensitive case mapping. Keep raw
native accessor admission closed when there is no guest execution context.

## Specification versus native shortcut

The published ECMA-402 TransformCase algorithm canonicalizes the complete locale
list before selecting its first entry. Native Node 22.23.2 skips later entries
for these methods, including malformed tags. Test full validation and getter
order directly against the published algorithm; use native output as the oracle
for valid inputs and individual locale mappings, not for that shortcut.

https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/locale-sensitive-functions.html

## Verification and delivery

Cover Turkish/Azeri, Lithuanian, Greek, expanding mappings, lone surrogates,
unsupported-first-locale fallback, primitive and boxed receivers, inheritance,
holes, locale getters/coercion, errors, extra arguments, metadata/freezing,
pending/completed replay, sparse-list/coercion/work/output budgets and raw native
getter rejection. Use the focused maintained String, Intl, Date and boxed
primitive cohorts, scoped lint/types, selected workspace build and the actual
harness below; inspect its screenshot before the atomic commit and push.

The initial three-file cohort passed 320 tests; the wider eight-file cohort
passed 580 tests before two additional native-work/admission regression checks.
The native Promise import-policy issue remains separate and unresolved.

The final focused cohort passed 582 tests across eight maintained files. Scoped
lint and package types passed. The additional checks prove work-budget rejection
occurs before native case conversion and raw native locale getters are not run.

The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The actual harness passed and its PNG was visually inspected after
70 uncached screenshot-runner build tasks in 62.053 seconds. Numeric locale
formatting probes are separate follow-up work, not covered by this delivery.
