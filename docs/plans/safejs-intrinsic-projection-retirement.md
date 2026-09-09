# Intrinsic accounting projection retirement

## Evidence

Full gate 27773 at cae903ff2 failed the unchanged camera timeout and D3 sandbox
deadline. Both workloads passed the later one-worker integration run 96480;
their full-suite timing reliability is still unresolved.

A fresh built-runtime profile at the recovery candidate completed the first
two-point camera batch with matching native JSON output in 2225.19 ms wall and
2130.25 ms process CPU (76141). The complete original native fixture was also
checked against its recorded output. Sampled self time included 1004.21 ms in
the data visitor and 281.62 ms in intrinsic retention. Fifty position ticks
landed on the unconditional `intrinsicDataRoots.delete(record.dataRoot)` call.
Sampling is diagnostic evidence, not an optimization benchmark.

Two focused tests failed before modification (23731): an intrinsic record with
no accounting projection called delete on both measurements; a retired boxed
projection was deleted again on the next unchanged measurement.

## Change and verification boundary

Track whether each record has an installed accounting projection. Set the flag
when a boxed projection is installed; clear and delete only when an active
projection retires. Descriptor scans, revision checks, prototype tracking,
capture-before-callback ordering, and all contributions remain unchanged.

Verify no deletion occurs for never-installed projections, exactly one deletion
occurs on retirement, and later mutations reinstall and retire the same root
correctly. Run existing projection, intrinsic capture and budget tests. Compare
runtime performance before claiming any speedup; do not relax workload budgets,
assertions or timeouts. No release or push is authorized.

The first implementation passes 29 tests across projection retirement, intrinsic
data roots, intrinsic capture, and data-budget checks (46047), plus package
TypeScript (2045). The original built runtime is copied to
`/tmp/safejs-projection-baseline.Gf8GN6/dist`; copy session 52532 completed before
the candidate rebuild began. The candidate's object-model source matches the
working-tree file byte-for-byte. No timing improvement is claimed yet.

## Alternating built-runtime comparison

The selected rebuild passed 23 builds and four fresh-process import checks
(19732). Emitted object-model JavaScript differs from the preserved baseline
only in the active-projection flag and conditional retirement.

The first comparison (47323) ran two warmups per implementation, then six
alternating baseline/candidate pairs, reversing order on odd rounds. Both
implementations ran in one process, with explicit GC before each measured run;
the same first two-point camera batch, seed and maintained budget limits were
used. Every output matched the native control, and the full native fixture
matched its recorded result before the benchmark. No other agent-started test,
build or lint process ran alongside the comparison.

Median CPU time was 1488.793 ms baseline versus 1407.814 ms candidate (5.44%
lower). Median wall time was 1433.475 versus 1283.380 ms (10.47% lower). A fresh
process repeat starts with the candidate first and uses four alternating pairs
(50112). These are workload-specific measurements, not a full-suite timeout fix.

The fresh-process repeat also passed every output comparison. Median CPU was
1588.158 ms baseline versus 1562.009 ms candidate (1.65% lower), but wall time
was 1684.949 versus 1705.778 ms (1.24% higher). Thus the measurements support a
modest CPU reduction, not a consistent elapsed-time gain or resolution of the
full-suite deadlines. Candidate CPU was lower in nine of the ten paired runs
across the two processes; no statistical significance claim is made.

The candidate now includes the new retirement tests. Session 43492 runs the
intrinsic test family, data-budget tests, camera and D3 arity workloads with one
worker. Scoped ESLint passed (93236) in the main workspace. No benchmark
ran concurrently with either of these verification processes.

The isolated selection completed successfully (43492): 80 tests across ten
files passed in 36.40 seconds, including unchanged camera and D3 workloads.
Together with the 29 initial focused tests, TypeScript, scoped lint and the
selected build, this supports retaining the small accounting optimization.
The two earlier full-suite deadline failures remain open; this change does not
establish full-suite reliability or complete JavaScript compatibility.
