# Retained-accounting allocation overhead

## Validated problem

CLI release 34069004089 timed out in a complete Float32 camera fixture at the
unchanged five-second test limit. Local fixture tests took 3–4.5 seconds. A
profiled first-case run took 3,956 ms (source) / 3,502 ms (built output), with
11,558 interpreter steps and 7,123 peak data units. CPU samples concentrated in
ordinary-record descriptor dictionaries and nested flatMap intrinsic-retention
scans, not camera arithmetic.

A descriptor-capture microbenchmark measured 193 ms for descriptor dictionaries
versus 52 ms for captured descriptor pairs at the same 100,000-iteration count.
The original intrinsic scan creates an empty array for each unchanged descriptor.
Tests reproduce that overhead and preserve exact measured units, managed fields,
symbols, aliases, accessors, prototype changes and callback-driven mutation.

## Implementation

Capture intrinsic changes with direct loops into one list, avoiding nested
flattening arrays. An initial streaming version changed capture timing: a
retained callback could alter a later intrinsic value before it was observed
(111 units instead of the original 18). A failing test establishes the need to
capture all changes before returning the iterable; retain the captured-list
semantics while avoiding transient arrays.

Capture ordinary-record descriptors as pairs before visiting any child values.
Do not inline descriptor reads with recursive visits, execute getters, cache
mutable graphs, skip budget checks, raise timeouts, or trim the camera fixture.
Avoid extra symbol filtering/mapping work for the common symbol-free record.

## Verification

Run focused allocation, record-accounting, bookkeeping and full native-camera
trace tests; compare first-case step and peak-data counts with the baseline.
Run the full maintained SafeJS suite with only the explicitly separate native
Promise import-policy and Array subclass probes excluded, then lint/types and
the selected workspace build. Reuse the real array-locale harness, whose
intrinsic mutations exercise retained-state accounting, and inspect its CLI
screenshot. Commit and push this accounting improvement separately from the
already delivered playground test-stability change.

## Focused results

The final four-file cohort passes 42 tests, including complete camera traces at
2,366/2,341/1,773 ms. A sequential comparison of the unchanged built baseline and
optimized source measured 3,431 ms versus 2,219 ms for the first camera case.
Both match the complete expected JSON trace, take 11,558 steps, and retain a
7,123-unit peak. Timing measurements are diagnostics, not flaky unit-test gates.

The full maintained SafeJS run passed 17,258 tests across 502 files, with 41
existing skips (one file), in 226.72 seconds. The two disclosed future-probe
files were excluded and are not counted as passes. Scoped ESLint and TypeScript
checks pass.

The selected build completed 23 dependency-closure tasks and four import smoke
tests. The reused array-locale harness passed with --data-size 8000000, and its
screenshot was inspected. Its root build completed 70 tasks with zero cached
results. No matching open camera/timeout GitHub issue was found to close.
