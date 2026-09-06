---
title: Collection constructor adders
---

## Validated gap

Eight regression tests failed because Map and Set constructors directly inserted
entries, ignoring overridden `set` and `add` methods. This also skipped getter
lookup, callable validation and iterator cleanup when the adder throws.

## Implementation

After the nullish-input shortcut, read the adder once, validate it before
acquiring the iterator, and retain it for the complete construction. Preserve
the synchronous direct-storage path only for the exact default intrinsic.
Invoke overrides with the new collection as receiver. Map reads entry key and
value before invoking its adder. Reuse existing iterator-close handling and
ignore the adder's return value, including guest promises.

## Verification

- Original eight failures now pass.
- Expanded 19 tests cover nullish inputs, ordering, cached lookup, receiver,
  delegation, async returns, cleanup and checkpoint restoration.
- Collection and iterator compatibility cohort: 169 passed before the final
  three ordering/checkpoint cases.
- Scoped lint and types passed. Full package suite: 16,466 passed, 41 skipped.
- Selected workspace build passed, including four built-import checks.
- Paired CLI harness passed and its screenshot was visually inspected. Its
  root build completed all 70 tasks uncached.

## Remaining collection gaps

Collection instance-owned properties, explicit prototypes and subclass state
remain incomplete. The prior prototype plan records concrete reproductions;
these are separate requirements, not addressed by constructor adder dispatch.
Six additional failing own-property tests cover assignment, accessors and
internal-storage name isolation for both collections. They remain outside this
commit and were added after the full green package run.
