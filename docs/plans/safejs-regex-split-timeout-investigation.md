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

## Intrinsic registration optimization

Three semantic checks were added before changing implementation and passed in
the 15-test original intrinsic suite (93abf6): primitive leaves do not gain
identities; object aliases/cycles keep their paths; primitive-valued unsupported
symbol keys still reject; guest accessors retain identities without invocation;
native accessors and duplicate identities still reject.

Registration now validates symbol keys before skipping primitive data leaves.
Object-valued data descriptors enqueue their child and bypass accessor scanning.
No budget measurement, mutable-state scan or object traversal is removed.

End-to-end 100-run batches are noisy: baseline median milliseconds
48.87/40.58/41.96 (06d8bd), candidate 40.07/57.68/36.45 (0f9587, c9ab03).
Do not claim an end-to-end speedup from these observations.

A same-process in-memory comparison transpiles HEAD and candidate versions of
the registration module with the same dependencies, alternates execution order
over six rounds, and checks identity lists for equality. No repository source
is rewritten by the probe. A primitive-heavy synthetic graph consistently
improves (b22e69). On the actual current builtin graph, all 943 identity paths
remain equal; 50 registrations per round take 86.47–98.64ms on the baseline and
63.73–71.01ms on the candidate (96ee71). The graph is already constructed, so
this isolates registration work and does not measure whole-realm construction
or whole-suite timeout headroom.

The 365-test intrinsic/function-realm cohort across 21 files passes (4f5624),
and package TypeScript (cf6e80) and scoped ESLint (ab0d00) pass. This qualifies a small local setup-cost
improvement; the full-run regex/split timeout issue remains open.
