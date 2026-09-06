---
title: Date prototype graphs and subclasses
---

## Validated failures

Nine failing native-oracle tests demonstrate missing Date prototype links,
prototype reflection and own methods, inherited overrides and deletions,
prototype-based instanceof, and Date subclass construction. The native oracle
runs in an isolated VM so prototype mutations do not contaminate the test host.

## Implementation

Install Date into the shared sandbox prototype graph. Date.prototype is an
ordinary object without a DateValue slot and inherits Object.prototype. Install real method
descriptors rather than a separate fallback method map. Keep receiver brand
checks, including rejection of Date-like objects without a time slot. Make the
constructor a guest intrinsic and allocate subclass instances using new.target's
prototype after computing the Date time value.

Use the normal property lookup, instanceof, coercion, and prototype mutation
paths. Preserve cycle detection, non-extensibility checks and data accounting.
Normal Date values keep implicit default prototypes so data-only copies do not
accidentally retain the entire intrinsic graph.

Three additional failures exposed replay and null-prototype copy gaps. Preserve
explicit null prototypes through ordinary copies, export and both snapshot
formats. Validate the new optional snapshot flag. Trusted run replay reconstructs
custom Date state; copied snapshot roots and data-only copies of non-null managed
graphs remain rejected. This does not claim portable arbitrary custom-prototype
or accessor graphs, active class continuations, or native Date subclass imports.

## Checks and delivery

Cover subclass fields, multilevel inheritance, super methods, descriptors,
accessors, undefined inherited properties, borrowed method brand checks,
prototype cycles and frozen no-op mutation. Test pending/completed run replay,
completed host-effect non-repetition, direct null-prototype snapshots, malformed
flags and prototype-retained budget limits.

Run the maintained SafeJS unit suite, scoped lint and types, selected workspace
build and this real CLI harness with screenshot inspection. The unresolved
native Promise import-policy tests are excluded explicitly, not counted as
passing. Push this atomic implementation to main and keep monitoring release
publication while investigating the next validated limitation.

The maintained suite passed 16,864 tests with 41 skips across 490 passing files
and one skipped file (106.14 seconds), with only the native Promise import-policy
file explicitly excluded. Scoped ESLint and type checking passed. The direct
portable Date snapshot test also passed in a separate nine-test snapshot run.
Four newly reproduced Date argument-coercion failures were created after broad
suite collection; they are the next separate issue, not part of this green count.
The selected build completed 23 dependency-closure tasks and four native import
smoke tests. The screenshot runner completed 70 uncached build tasks in 20.725
seconds; the real harness passed and its PNG was visually inspected.

Follow-up correction: the initial implementation and this plan incorrectly
treated Date.prototype as a branded invalid Date. Native execution and the
published ECMAScript 2026 specification disproved that assumption. The
date-prototype-brand follow-up replaces it with an ordinary object and adds
explicit brand-check regressions; genuine Date instances remain branded.
