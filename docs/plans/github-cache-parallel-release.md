# GitHub cache and parallel release verification

## Implementation

The user authorized GitHub Actions caching and all proposed concurrency/sharding
improvements on September 2, 2026, and requested measured build/release times.

1. Build and smoke-test the complete packed CLI fresh in the `build` job.
2. Transfer only that run's build outputs in a tar artifact, preserving executable
   modes. Root and workspace dist directories come from the maintained full build.
   The artifact name contains the checkout SHA and downloads are scoped to the
   current workflow run, not a previous successful build or a mutable latest tag.
3. After build, run `checks`, `unit`, and four balanced `bash` jobs independently.
   Every job uses the same SHA and a clean npm install. Signature audit, package
   lint and required lint stress stay mandatory. Matrix fail-fast is disabled so
   failures in one shard do not hide the other shards' evidence.
4. Unit verification runs the fresh group, then the explicitly reviewed cached
   group through local-only Turbo. GitHub Actions persists `.turbo/ci-cache`.
   Runtime identity, lockfile and actual Turbo source inputs govern reuse; the
   archive restore prefix is not itself permission to skip any test.
5. Bash retains its native npm unit command and runner controls. The opt-in shard
   planner derives membership from discovery, uses historical durations only for
   assignment, and keeps unknown/changed or unreviewed files serial. Five narrowly
   reviewed pure test files can run two at a time. See `bash-ci-shards.md` for the
   source fingerprints and qualification; fingerprints do not replace source
   authentication or cache execution.
6. `release-stable` requires successful checks, unit verification and every Bash
   shard. It uses a fresh checkout and runs the existing semantic-release/prepack
   route. Build verification and publication are never result-cached. Existing
   workflow-level release serialization remains unchanged.

Dependency downloads use setup-node's npm cache; npm clean-install and lifecycle
scripts still run. No node_modules directory, source tree, native verification
receipt, or published artifact is restored from a task cache. GitHub hosts the
cache; no server, Vercel account or new secret is needed.

## Validation and measurement

- Use `npm run lint:workflows`, not workflow unit tests.
- Validate the merged Bash discovery/runner controls with the real CI environment,
  preserving incoming main changes and registering every new discovered file.
- Validate the actual fresh unit route, then use normal commit and push hooks.
- The real fresh-route check caught the workspace-resolver command's explicit
  shared Vitest config. Two red/green controls now admit that exact config spelling
  with either trailing-slash form; arbitrary configs and native commands remain
  excluded from cache admission.
- Monitor every verification job and publication after pushing. Fix failures at
  their cause; do not increase deadlines or retry them into a passing measurement.
- Record cold run build-step/job duration, verification critical path, complete
  published workflow time, total runner time, and Turbo cache hit/miss counts.
- Dispatch the same revision again for a warm cache measurement. The
  `cold_cache` dispatch option can force actual unit execution without removing
  existing archives. Native/build/smoke checks always run in both cases.
- A same-revision warm dispatch normally has no new version to publish. Report
  that explicitly and compare build and verification durations separately; do not
  attribute the missing publication/prepack work to caching.

The initial focused unit-cache sample was 13.805s cold and 2.390s cached locally.
It is not evidence for an end-to-end CI speedup. Actual GitHub timings will be
reported only after the corresponding jobs finish. More simultaneous runners may
lower latency while increasing billed runner-minutes; report both rather than
claiming a linear speedup or a cost reduction.
