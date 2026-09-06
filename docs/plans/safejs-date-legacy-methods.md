---
title: Legacy Date methods
---

## Validated gap

Three initial native-oracle tests fail because getYear, setYear and toGMTString
are absent. The expanded cohort has 17 failures and three passing rejection
cases before implementation. ECMAScript 2026 Annex B defines these compatibility
methods: https://raw.githubusercontent.com/tc39/ecma262/es2026/spec.html

Add getYear and setYear to the maintained Date method declarations. Reuse the
existing receiver checks, guest coercion, budget and captured-time setter path.
Like setFullYear, setYear recovers invalid dates. Install toGMTString as the exact
same function object as toUTCString, not a wrapper with different identity/name.

The published algorithm captures the initial time before setYear coercion. Test
this requirement using the original date's numeric setFullYear result, rather
than relying on older Node behavior for mutation during coercion.

## Verification

Check legacy year offsets, invalid dates, 0–99 mapping, fractional and negative
years, ignored arguments, conversion hints, receiver checks, symbol/BigInt
rejection, function metadata, alias identity, subclasses and pending/completed
replay. Run the maintained Date cohort, scoped lint/types, selected workspace
build and this actual harness with screenshot inspection. Commit and push this
atomic addition separately. Monitor publication while continuing further work.

The 160 focused tests across five files pass, as do scoped lint and package types.
The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The actual harness passed and its PNG was visually inspected after
70 uncached screenshot-runner build tasks in 30.564 seconds. Three separate
locale-formatting probes fail because those methods remain absent; they are
the next validated gap, not covered by this improvement. The separate native
Promise import-policy decision also remains unresolved.
