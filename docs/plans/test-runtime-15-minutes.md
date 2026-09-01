# Serial test runtime: fifteen-minute target

Window: September 1, 2026 14:10 CDT through September 2, 2026 14:10 CDT.

## Baseline

Release run 33542539342 spent 29m51s in workspace tests. Root Vitest took
6m58s and then workspace tasks repeated much of that coverage. Safe Bash took
17m50s, including runner tests. Full release succeeded but publication was
skipped because main advanced. A green workflow is not publication evidence.

## Improvements

1. Keep root and every declared workspace lifecycle, without concurrency changes.
   Derive root exclusions only from literal selectors in recognized shared-config
   workspace Vitest commands. Preserve orphan tests, package scripts, wildcard
   commands, custom configurations, and unsupported commands in root coverage.
   Recompute ownership on each run; never reuse a previous test result.
2. Reduce the directory-stack boundary fixture's repeated setup while retaining
   the inclusive 4096 limit and error-precedence assertions.
3. Investigate repeated clean archive setup, preserving committed-revision checks,
   isolated negative controls, and original evidence.

## Verification and delivery

- Ownership regression: 20 in-memory tests pass, including quoted literal
  filenames that must not accidentally become exclusion globs.
- Actual Vitest inventory: 1135 original files = 541 root files + 594 files
  owned by recognized workspace commands; zero uncovered files.
- After synchronizing the existing lockfile dependencies, the partitioned root
  run passes 12,587 tests in 145.62s (539 passing files, two existing skips).
  The earlier full root run took 324.96s locally. This is a local root-only
  measurement, not a complete CI timing claim.
- Use in-memory ownership regression fixtures and verify actual discovered test
  inventories before and after root ownership partitioning.
- Record focused and full serial timings; fifteen minutes remains unproven until
  a complete CI test stage meets it.
- Commit each independently validated improvement with its evidence. Push main,
  monitor failing tests, and verify npm publication and release ancestry.
- Preserve other engineers' changes and do not modify concurrency settings.
