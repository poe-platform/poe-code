# Regex and split full-run timeouts

## Baseline

The post-weak-accounting full run (88b29b) reported eight regex-cursor and one
string-split independent-test timeouts at 5,000ms. Neither test file, its cases,
assertions, budgets, deadlines nor worker configuration has been changed.

The two affected files pass together unchanged: 1,835 tests in 67.64 seconds
(453038). This is focused evidence, not a repair or proof of an environmental
cause. The full run remains failing.

## Representative source-runtime profile

A read-only Node 22.23.2 inspector probe (5d4225) repeats the empty-pattern
matchAll /gis case on `a\nB`, starting at zero, 100 times with the maintained
5,000-step budget. Every result, error name and final lastIndex matches native
execution. This reconstructs the scenario, not the exact test-source bytes.
No repository files or runtime settings change.

With inspector enabled: minimum 31.01ms, median 37.45ms, maximum 111.63ms.
These are source-process observations, not Vitest headroom or a benchmark win.
Leading sampled self time includes values.ts anonymous frames (597.6ms),
registerBuiltinIdentities (567.0ms), object-model.ts anonymous frames (438.2ms),
and garbage collection (408.7ms). Transformed source line numbers are not
meaningful. The profile is retained in summarized form, not as a disk artifact.

## Next investigation

Inspect intrinsic identity registration allocation and traversal. It currently
builds pending paths even for primitive property values that are discarded at
the top of the traversal loop. Any optimization must preserve object aliases,
prototype ownership, accessor closure registration, duplicate identity errors,
well-known-symbol identities and rejection of unsupported symbol keys.

Do not skip mutable-state budget accounting, cache guest objects across realms,
raise deadlines, reduce test cases, or retain a performance change without
repeatable before/after evidence and semantic tests. No runtime optimization,
push, release or complete-conformance result is claimed here.
