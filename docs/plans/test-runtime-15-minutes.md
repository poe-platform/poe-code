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
- Record focused and full serial timings; qualify the target using a complete
  CI test stage rather than a root-only or selected-test measurement.
- Commit each independently validated improvement with its evidence. Push main,
  monitor failing tests, and verify npm publication and release ancestry.
- Preserve other engineers' changes and do not modify concurrency settings.

## First complete CI timing checkpoint

Release run 33578842810 at `cd9ce19e4` completed successfully on September 2,
2026 UTC. Its complete workspace test step ran from 01:28:48 to 01:41:03:
**12m15s**, meeting the fifteen-minute test target in this observation. The
whole job ran from 01:24:51 to 01:41:55: **17m04s**. The native Bash runner
passed 227 controls; its main suite passed 18,249 cases with 63 existing skips.
All declared workspace stages completed successfully. No concurrency setting
was changed to obtain this result.

Publication was explicitly skipped because remote main had advanced. This is
not a successful stable-release claim: the latest published version at this
checkpoint remains v14.0.4. Preceding successful test stages took 18m20s and
18m52s, so runner variability is substantial and this one observation is not a
guaranteed runtime or an isolated causal measurement of one commit.

Later main revisions include shared-Vitest change `81e36dc8b` and concise-output
change `4c3c553d2`; neither was included in this checkpoint run. Their releases
and the remaining atomic improvements still need monitoring through actual
publication. Raw checkpoint evidence is retained
at `/tmp/poe-release-cd9ce19e-raw.log`; `gh run view --log` omitted the long
unit-test output, so the complete job log was fetched from the Actions API.
