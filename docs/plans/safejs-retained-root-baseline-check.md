# Retained-root baseline check

The full package run reported three retained-root tests exceeding their fixed
3,500-unit limit. A fresh focused run reproduced all three failures.

Built-ESM probes measured the same public-run source with zero, 2,000, and 4,000
retained string units. Results were respectively 1,651/3,651/5,651 for return 7,
1,653/3,653/5,653 for a normal function, and 1,656/3,656/5,656 for an async
function. The retained string is counted exactly once in each case. These
observations do not validate a runtime double-counting bug, so no accounting
implementation is changed.

Replace the stale fixed cap with each source's measured zero-root baseline plus
2,000. Require the charged peak to equal that exact sum, not merely fall within
a loose range. Repeat with a one-unit-smaller budget and require a dataSize
budget error at the exact expected charge. Keep all existing low-level root
tests and remove registered roots in finally blocks.

All 11 focused tests pass, including the new exact boundary checks. Scoped
ESLint and package TypeScript pass. The last full-gate result remains
23,985 passed, 31 failed, and 37 skipped; this focused change addresses three
of those failures but is not a full-suite rerun.

README verification summary updated. No runtime or visual CLI changes. No push
or release.
