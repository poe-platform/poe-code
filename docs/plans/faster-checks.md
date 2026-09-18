# Faster checks with measured incremental delivery

Implement and release each improvement independently on main. Preserve task
membership, dependency closure, npm lifecycle hooks, per-file test isolation,
native checks, and authenticated lint input validation.

## Delivery sequence

1. Remove build layer barriers with dependency-ready scheduling, including unit
   prerequisites. Reproduce idle capacity with an in-memory scheduler test.
2. Enable shared machine build and unit result caching. Cache packages separately,
   combine compatible misses in Vitest, and expose explicit uncached execution.
   Include source dependencies, assets, shared setup, commands, environment,
   runtime, and tool versions in content keys. Never cache failed execution.
3. Narrow package invalidation and add affected selection derived from maintained
   workspace declarations. Validate source imports against cache dependency closure.
4. Cache ESLint diagnostics without skipping authenticated input checks. Measure
   initialization, traversal, parsing/rules, cache hits, and total duration.
5. Enable incremental TypeScript compilation/checking where clean output deletion
   does not invalidate incremental state. Preserve complete build artifacts.
6. Benchmark Biome and Oxlint, migrate compatible ordinary lint checks to the
   measured faster option, and retain specialized ESLint processors and checks.

## Measurement and verification

Measure elapsed time on the same machine with runtime and scope recorded. Compare
fresh execution, warm identical execution, one leaf source change, a shared
dependency change, and a second checkout. Separate hashing and cache restore
overhead from execution. Retain only successful, equivalent checks as comparisons.
Store disposable logs and screenshots in out and remove them after use.

Use failing memfs tests before code changes, focused checks during development,
and full maintained npm test and lint gates before shared-infrastructure delivery.
Record local commit, verified remote main SHA, and successful GitHub publication
separately. Continue implementation while releases run and monitor every delivery.

## Initial evidence

- 79 workspaces, 47 unit tasks, 221 dependency edges, ten build layers.
- Normal unit route requests 26 serial prerequisite builds and reports UNCACHED.
- 39 compatible tasks already share one isolated Vitest execution.
- Seven-package CI cache group: 91 files, 3,865 tests passed; 10.78 seconds elapsed,
  9.69 seconds in Vitest. Brief overlap with lint means this is indicative only.
- Root ESLint probe stopped at 72.86 seconds without completion; lower bound only.

## Progress

Implementation and completed-run baselines are pending.
