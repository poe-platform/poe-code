---
title: Collection instances as prototypes
---

## Evidence and change

Native JavaScript permits Map and Set instances as prototypes. SafeJS rejected
both through Object.create. Ten regression tests initially failed. Accept
trusted collection instances as prototype links, retaining cycle and
extensibility checks. Inherited methods still validate the actual receiver's
storage brand; prototype inheritance alone does not create collection storage.

The initial implementation exposed two enumeration failures: for...in read
internal collection wrappers instead of guest property tables. Both key
collection and live deletion checks now use the guest properties. Existing
shadowing rules still apply, and accessors receive the child object as this.

## Validation

Fourteen focused cases cover property lookup, prototype identity, instanceof,
accessor receivers, enumeration, shadowing, deletion, storage brand rejection,
cycles, and pending/completed checkpoint restoration. The prototype/for-in
cohort passed 55 tests. Run the complete SafeJS workspace unit suite, scoped
lint and types, then its selected build. Execute this harness with the real CLI
and visually inspect its screenshot; it requires no agents or capabilities.

The complete workspace suite passed 16,592 tests with 41 skipped. Scoped lint
and TypeScript checks passed. The next regex regression was added afterward
and is not included in this change or this green test count.
The selected build passed all four built-import checks. The real CLI harness
passed and its screenshot was visually inspected; its root build completed
all 70 tasks uncached.

This does not remove data-only copy/replay restrictions on custom prototypes.

## Confirmed follow-ups

- Object.create(/x/) rejects a regex instance as its prototype; native
  JavaScript accepts it and inherits its own properties.
- Object.setPrototypeOf rejects number, boolean and string targets even with
  valid prototypes. Native JavaScript returns these primitive targets unchanged.

Keep these as separate atomic improvements with their own regression tests.
