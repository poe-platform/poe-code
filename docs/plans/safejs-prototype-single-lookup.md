---
title: Single-lookup prototype validation
---

# Explicit prototype lookup work

The namespace CLI run 34139672203 failed two unchanged camera cases at 6002ms and
5252ms against their 5000ms timeout. All 35,862 other tests passed; 42 were skipped.
SafeJS 0.1.378 published independently. Do not treat the preceding green CLI run
as proof that the intermittent runtime cost is resolved.

A fresh built-SDK profile on a4abae49c, with unchanged fixtures and budgets,
passed all full trace comparisons at 1908/1726/1450ms locally with profiling
enabled. Profile: /tmp/safejs-camera-current.eHwN2L/camera.cpuprofile. Largest
self-time groups were graph visit (1957ms), intrinsic retention callback (1001ms),
getSandboxPrototype (393ms), and GC (306ms). The faster local host does not
reproduce the CI timeout and is not evidence that it is fixed.

getSandboxPrototype performs has(value) followed by get(value) for explicit
links, although the map only stores object or null and undefined uniquely means
absent. Two TDD cases (explicit object/null) failed with one unnecessary membership
lookup each; three fallback controls passed. Read the map once and preserve
explicit null, missing links, realm-free returns and realm-specific fallbacks.
No prototype or data-size cache is introduced, and no resource checks are removed.

Validate prototype mutation, data accounting and the complete camera fixtures;
run the real paired harness and inspect its screenshot. A reduced lookup count
is proven by the regression; do not claim a stable end-to-end or CI speedup from
small local timing samples. Larger graph/retention costs still need investigation.

Focused validation passed 194 tests across 11 files (9.83 seconds), including all
unchanged camera cases, prototype/realm fallbacks, intrinsic mutations and data
budgets. An earlier four-file route also passed all 44 tests. ESLint and package
TypeScript passed. The actual harness passed after 70 uncached build tasks
(63.79 seconds) and root bundling; its screenshot was inspected (zero spawns).

The rebuilt SDK passed all complete camera traces at 1721/1490/1233ms without the
profiler. Budgeted steps were 11794/11206/9957 and peak-data values 7382/6771/6160.
The earlier baseline included profiling overhead, so these timings do not prove
an end-to-end speedup. The regression does prove the redundant membership lookup
is removed for explicit object and null links. The CI timeout remains unresolved
until subsequent publication evidence demonstrates the gate succeeds.
