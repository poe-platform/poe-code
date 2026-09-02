# Reuse Vitest startup for compatible unit tasks

## Purpose

Reduce repeated Vitest/Vite initialization, not test coverage or concurrency.
Keep individual workspace unit commands available and preserve native runners,
build prerequisites, custom configurations, lifecycle hooks and explicit test
argument forwarding. Do not change GitHub workflow concurrency.

## Baseline and prototype

On September 1, 2026, the same checkout and Node 22.22.2 completed the root
Vitest task and 38 standard workspace tasks in 297.571 seconds when launched
separately. A temporary reusable Vitest instance ran those same 39 phases
strictly sequentially in 216.999 seconds, saving 80.573 seconds (27.08%).
Both runs used the existing two-worker pool with per-file isolation enabled.
The candidate did not overlap workspace phases. Both reports contain exactly
1,138 files and 29,601 cases: 29,558 passed, 43 skipped, none failed. The
candidate recorded zero unhandled errors. Ordered per-file case/status parity
holds except two existing names interpolate the process ID or current time;
their positions, counts and statuses match.

Evidence is local and is not a CI runtime or publication claim:

- `/tmp/poe-separate-vitest-baseline-20260901/summary.json`
- `/tmp/poe-phased-vitest-benchmark.json`
- `/tmp/poe-phased-vitest-timing.json`
- `/tmp/poe-vitest-parity.mjs`

## Implementation and gates

1. Expose parsed literal selections from the existing ownership parser rather
   than introducing a second shell parser or filename list.
2. Opt the root full-unit route into a shared Vitest process only for supported
   root/config scripts, no lifecycle hooks, no forwarded arguments and the
   existing serial workspace mode. Preserve every build prerequisite and every
   noncompatible/native task.
3. Discover root files through its actual root configuration and workspace
   files through their declared selectors. Reject overlaps, missing root files,
   unexpected empty phases and unsupported pool/isolation changes.
4. Await each phase before starting the next, retain standard failure evidence,
   stop on failures and always close both discovery and execution contexts.
5. Prove selection/fallback/error/cleanup behavior with memory-only unit tests;
   run real failure/isolation controls and repeat full-suite parity/timing before
   enabling the new full-unit route.

The shared process is deliberately a root npm task. Workspace npm hooks must
never be silently absorbed into it. Individual workspace commands keep their
native npm lifecycle and environment; compatible shared tests use the root
task environment. No test outcome is cached.

## Current status

Six selection-discovery tests first failed because the new export did not exist;
the original twenty ownership controls passed. Execution controls then failed
10/10 before the runner existed. The native-routing red run failed two controls
while its argument-forwarding baseline passed. The integrated focused run now
passes 243 tests, including the existing native npm lifecycle/cleanup tests.

The actual reusable implementation completed 1,139 files and 29,630 cases in
196.617 seconds locally: 29,587 passed, 43 skipped, no failures. This includes
29 newly added ownership/execution controls, but predates the three new native
routing controls. Its unchanged original-case coverage is the same as the
prototype; this faster individual run is not a controlled additional speedup.

Real temporary two-phase fixtures prove worker-global/environment isolation and
exit zero on success. Assertion, import, afterAll and unhandled-error variants
each exit one and retain their original failure sentinel and source location.
The reporter prints one cumulative summary rather than cumulative-duration
summaries after every workspace. Evidence: `/tmp/poe-vitest-phase-control-*.log`.

The root shared command is now enabled for final validation. The native parent
passes the exact planned phase paths to the child, which rechecks them before
execution so changed ownership cannot silently drop a planned workspace.
Individual commands, hooks, filtered runs and other native tasks retain their
original routes. Publication and full CI timing are still pending.

The real npm shared command also passes under Node 22.23.2, matching the CI
runtime: 1,140 files, 29,590 passed cases and 43 skips (29,633 total), in
227.97 seconds of Vitest-reported runtime. Its deliberate mismatched phase-list
invocation fails before running tests. Focused TypeScript checks for all three
new/updated ownership and routing test modules pass. Logs:
`/tmp/poe-shared-cli-node22.log`, `/tmp/poe-shared-selection-drift.log` and
`/tmp/poe-shared-routing-types.log`. No new native-filesystem unit fixtures were
introduced; the routing tests use memfs and owned child-process mocks.

## Pre-push compatibility review

The first shared-runner commit remained unpublished while two additional native
compatibility gaps were reproduced and fixed. Native Vitest sets `TEST=true`
as well as `VITEST=true`; the shared runner now sets and restores all native
startup markers. Vitest clears its snapshot summary between phases, so the
reporter now prints snapshot notices immediately instead of losing an earlier
phase's obsolete-snapshot warning. Clean runs still have one cumulative summary.

Both new unit controls failed against the initial implementation, then all 245
focused ownership/routing/native-lifecycle controls passed. Real temporary
controls establish native/shared parity: an inherited `TEST=sentinel` is
overridden during execution, and the same obsolete snapshot name remains visible
with exit zero. Logs: `/tmp/poe-shared-compat-red.json`,
`/tmp/poe-shared-compat-green.json`, and
`/tmp/poe-shared-compatibility-control-green.log`.

A second same-Node-22.23.2 comparison of the pre-fix candidate ran native tasks
in 238.009 seconds and shared tasks in 203.719 seconds: 34.290 seconds saved.
All 1,140 files and 29,633 ordered case/status records match, except the same two
documented dynamic names. This smaller observation confirms runtime variability;
do not present the original 80.573-second observation as a guaranteed saving.
Final startup-marker/snapshot-notice validation is required before pushing.
