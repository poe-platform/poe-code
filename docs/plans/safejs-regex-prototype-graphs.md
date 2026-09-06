---
title: Regex instances as prototypes
---

Seven regression tests reproduced rejection of regex instances as prototypes.
Accept trusted regex instances in prototype links and enumerate their guest
property tables rather than internal wrappers, including live deletion checks.
Keep receiver brand checks, cycle rejection, and extensibility rules intact.

The seven cases now pass: inherited properties and enumeration, accessors using
the child receiver, rejection of inherited internal slots, cycles, shadowing and
deletion, and pending/completed checkpoint restoration.

Validation: run SafeJS workspace tests, scoped lint and types, the selected
workspace build, and this harness through the real CLI. Visually inspect its
screenshot. No agents or host capabilities are required.

The workspace suite passed 16,599 tests with 41 skipped. Scoped lint and
TypeScript checks passed. The primitive-target regression tests were added
after this run and stay outside this commit and its green test count.
The selected workspace build passed its four built-import checks. The real CLI
harness passed and its screenshot was visually inspected. Its root build
completed all 70 tasks uncached.

The separately confirmed primitive-target Object.setPrototypeOf bug remains
the next atomic improvement; data-only custom-prototype restrictions are not
removed by this change.
