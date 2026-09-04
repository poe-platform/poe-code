# Guarded ESLint matching performance

## Evidence

Profiling the full guarded command on September 4, 2026 completed in 342.88
seconds with 9,619 configured files, all linted, zero errors or warnings,
25 boundary receipts, and 6,817 directories. The checkout also contains
in-progress SafeJS changes; those are not part of this lint optimization.

CPU samples attribute about 129 seconds to directory reads, 49 seconds to
minimatch matching, 26 seconds to its path-splitting regular expression,
and 17 seconds to ConfigArray's match wrapper. The profile is diagnostic,
not an isolated release-time benchmark: other local checks overlapped part
of the run.

## Change

Batch consecutive positive literal global-ignore paths into native glob
brace alternatives. The actual root configuration goes from 2,043 global
ignore patterns to 88. This is a different representation of the same
exclusions, not a reduction in lint coverage.

Only ASCII literal paths with a slash are batched. Wildcards, negations,
escapes, commas, braces, special characters, and trailing-slash patterns
remain untouched and terminate a batch. Bound batches to 32 alternatives
and 32,768 characters, below the matcher's single-pattern limit. Apply the
same representation to ESLint and the directory-ignore projection, after
validating the original supported configuration shape.

Keep every file read, directory listing, metadata operation, identity drift
check, boundary receipt, rule, and diagnostic. Do not cache file contents or
test results. Do not change non-global rule-specific ignores.

An ancestor-path decomposition experiment was removed because alternating
measurements did not show a reliable improvement.

## Validation

- Red/green tests for literal batching, ordering barriers, and batch bounds.
- Compare native unmodified ESLint selection against the optimized engine,
  including directory exclusions, re-inclusions, dotfiles, and glob syntax.
- Run all existing guarded lint regressions and both full-scale stress tests.
- Compare before/after selection on every twentieth tracked path (3,707
  paths), alternating execution order. Assert every classification agrees.
- Run the maintained full build, `npm test`, and `npm run lint`; verify
  GitHub validation and actual npm publication after pushing.

The isolated matching comparison is not an end-to-end lint or release
speedup. Directory metadata checks remain a substantial cost.

## Matching measurements

Four alternating samples on the same 3,707 tracked paths:

| Sample | Original (ms) | Batched (ms) |
| --- | ---: | ---: |
| 1 | 27,473.43 | 4,957.63 |
| 2 | 33,363.13 | 4,605.37 |
| 3 | 33,113.15 | 4,209.23 |
| 4 | 28,417.11 | 4,200.71 |

Median: 30,765.13 ms versus 4,407.30 ms, approximately 6.98 times faster
for classification. Fresh selection engines were constructed for each
sample, order alternated, and all result arrays matched exactly. These
measurements overlapped other local checks, so do not extrapolate them to
an isolated full-run latency guarantee.

The first full unit attempt found missing generated SafeJS compatibility
entrypoints after a prior selected build. Run the normal full `npm run build`
to restore root suffix outputs, then repeat the complete test route; do not
count that failed attempt as passing validation.
