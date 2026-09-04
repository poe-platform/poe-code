# Release throughput follow-up

## Scope

Improve local and GitHub release throughput without dropping test membership,
changing per-file isolation, caching additional tests, or skipping native npm
lifecycles. Keep unrelated SafeJS work untouched.

## Evidence

GitHub Release run 33904738247 took 3m14s for its build job, followed by
7m12s for the unit job. Fresh tests took 328s; cache-eligible checks then occupied
another 22s on the same critical path. The fresh shared Vitest run executed
1,056 files through sequential workspace-sized queues with two workers.

## Changes

- Validate every declared shared workspace selection before execution, then
  submit the disjoint, isolated files in one queue to the existing worker pool.
  Retain custom commands and pre/post hooks on their native route.
- Run existing fresh and cache-eligible GitHub unit groups as separate required
  jobs, both using the digest-verified build from the same workflow run.
- Enable npm download caching for scoped safe-package publication, while still
  running clean installs, artifact verification, and provenance publication.

## Validation and delivery

1. Capture a local fresh-unit baseline before changing the runner.
2. Add failing in-memory scheduling tests, then implement and run the maintained
   focused runner tests. Verify ownership, empty selections, errors, cleanup,
   environment restoration, isolation and reporter behavior.
3. Compare fresh-unit timing and membership; run the normal build, full uncached
   `npm test`, repository lint and `npm run lint:workflows` before pushing.
4. Commit exact owned files, push to main with normal hooks, and monitor both
   release workflows. Report published npm identity separately from job success;
   a publisher that skips a superseded commit is not a completed release.

No CLI visual or provider behavior changes are intended.

## Local results

On September 4, 2026, the same working tree and two-worker setting completed
`npm run test:ci:fresh` in 169.34s before batching and 143.63s afterward (15.2%
less wall time). Both runs passed the same 1,054 shared test files and 26,350
tests, plus seven native terminal-pilot files and 239 tests. Existing skips were
unchanged and are not counted as passes. This is a single local before/after
comparison, not a promise about GitHub runtime.

The new scheduling assertions failed eight cases against the old runner;
after implementation, all 67 focused runner, ownership and CI-group tests
passed. Workflow validation also passed.

Temporary execution evidence: `/tmp/poe-pipeline-fresh-before.log`,
`/tmp/poe-pipeline-fresh-after.log`, `/tmp/poe-pipeline-batch-red.log`, and
`/tmp/poe-pipeline-batch-green.log`.

The normal `npm run build`, full uncached `npm test` (including its native
post-test lint-stress hook), and repository-wide `npm run lint` all passed.
The full unit route retained all 40 declared tasks and two required builds.
Shared Vitest passed 29,782 tests; Bash passed 18,836 tests with 63 explicit
skips, plus 241 runner controls. Guarded ESLint checked 9,656 files with no
errors or warnings, followed by successful TypeScript and workflow lint.
Full logs: `/tmp/poe-pipeline-build.log`, `/tmp/poe-pipeline-full-test.log`,
and `/tmp/poe-pipeline-lint.log`.
