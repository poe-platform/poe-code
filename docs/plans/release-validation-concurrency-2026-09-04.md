# Release validation concurrency

## Evidence and intent

The old workflow serializes validation and publication together. Run
33889346521 was created at 15:25:02 UTC on September 4, 2026, but its first
jobs started at 15:33:25 UTC: more than eight minutes of queue time before
validation. Later runs show the same pattern. A newer main revision can make
the old revision ineligible for semantic-release after that old run has spent
minutes validating. A green workflow is not evidence of npm publication.

## Implementation

- Move the unchanged build, checks, audit, unit, and four Bash shards into
  a local reusable workflow, with only read permissions.
- Group the entire validation call by ref with cancellation enabled. Newer
  pushes supersede obsolete validation as a unit, including dependent jobs.
- Keep publication in the caller behind successful completion of every
  validation job. Serialize publication without cancellation, reusing the
  existing release group so an older running publisher remains protected
  during this migration.
- Forward the existing cold-cache input. Export the build archive digest
  from the called workflow and verify it before the publisher extracts the
  same-run, same-SHA artifact.
- Do not change semantic-release's branch-tip policy, caches, test membership,
  permission scopes, build commands, or package publication behavior.

## Validation

Use `npm run lint:workflows`, not workflow unit tests. Compare parsed job
definitions with the previous workflow to confirm validation gates did not
change. After pushing, observe the exact SHA's validation, release step,
and npm latest separately. No runtime reduction is claimed before measuring
the new workflow; the intended saving is obsolete-run queue time, not faster
individual tests. An uninterrupted active publisher remains intentionally
serialized.

## Follow-up

Profile the full guarded local ESLint run. Preserve its exact file admission,
receipt verification, filesystem drift checks, and uncached validation. Do
not trade away coverage for a faster reported time.
