# Intl structured-clone rejection

## Validated gap

September 8 built-runtime probes at remote-main d69afd3e2 compared native Node
22 structuredClone with SafeJS for Locale, Collator, DateTimeFormat,
DisplayNames, ListFormat, NumberFormat, PluralRules and RelativeTimeFormat.
Every native control throws DataCloneError. SafeJS accepts all eight and loses
their private brands by copying them as ordinary objects.

Segmenter, its segments objects and iterators reproduced the same problem in
the current candidate. Their three failing regressions have been fixed as part
of the undelivered Segmenter addition. The eight existing constructors need a
separate atomic fix; do not claim they were covered by Segmenter's guards.

## Work and checks

- Add failing tests for all eight constructor instances, including null guest
  prototypes so rejection depends on private brands rather than inheritance.
- Reject these branded objects at the guest structured-clone boundary before
  invoking custom property getters. Preserve ordinary objects, dates, maps,
  sets and other supported clone types.
- Keep portable guest snapshots distinct: snapshot serialization must continue
  supporting these objects even though structuredClone rejects them.
- Run focused clone and Intl snapshot regressions, lint and the maintained
  workspace build. Commit and push independently after Segmenter delivery;
  verify remote main and monitor publication while continuing other work.

## Implementation evidence

All 16 constructor/prototype combinations failed before the fix: cloning was
accepted and the custom getter was invoked once. A control ordinary object
inheriting NumberFormat.prototype already cloned successfully.

The clone boundary now rejects the eight private brands before property
traversal. This leaves snapshot serialization and ordinary inherited objects
unchanged. The combined clone and Intl regression passed 464 tests across
16 files, including the constructors' snapshot tests. Lint passed for both
changed code/test files. The maintained build passed all 23 selected workspace
builds and four fresh-import checks. Built-package probes on Node 18.18.0 and
Node 24.14.0 each verified all 16 rejection/getter-order cases against native
controls. This plan accompanies the separate fix commit; remote delivery and
publication must be verified after its push.
