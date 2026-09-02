# CI unit caching and parallel routing

## Requested behavior

On September 2, 2026, the user authorized GitHub Actions caching, concurrency,
separate verification jobs, and duration-balanced shards. Report actual cold and
warm end-to-end release and build times after delivery, not an estimated speedup.

## Unit routing and cache boundary

- Normal `npm test`, build execution, native npm lifecycle ownership, and existing
  explicit test selectors remain uncached and unchanged by default.
- `test:ci:fresh` and `test:ci:cached` partition declared non-Bash unit tasks.
  The separate Bash job owns the existing native virtual-bash unit command.
- Seven reviewed deterministic workspace suites opt into the cache through
  `scripts/ci-unit-cache.json`: frontmatter, markdown-reader, memory,
  package-lint, task-list, toolcraft-schema, and workspace-resolver. Their unit
  tests use pure logic, memory filesystems, checked-in fixtures, or mocked IO.
  Their production capabilities do not imply permission to cache native checks.
- New workspace tasks default to fresh execution. Cache admission requires a
  literal whole-src Vitest command, no pre/post unit hooks, a real declared
  workspace, and unique policy membership. Unsupported command/lifecycle changes
  fail closed rather than silently omitting tests. Review cache admission again
  when introducing native or environment-dependent tests to an admitted suite.
- Root/native tests, SafeJS, Bash, builds, packed smoke tests, signature audit,
  package lint, lint stress, and publication are not result-cached.
- Turbo wraps only the cache-eligible root task. Its inputs conservatively include
  the default tracked root tree, including dependency sources, fixtures, test
  helpers, declarations, lockfile, runner code and cache policy. This deliberately
  trades incremental hit rate for avoiding an incomplete dependency fingerprint.
- Runtime identity is supplied through hashed `POE_CI_RUNTIME`; CI provides exact
  Node dependency versions, OS/architecture, and runner image/version. CI, NODE_ENV,
  TZ, LANG and LC_ALL are also hashed; Turbo's strict environment mode remains on.
- Cache only task results/logs, not source or native authentication receipts.
  Use the local-only `.turbo/ci-cache` directory, persisted by GitHub Actions.
  No remote-cache server, Vercel account, or new secret is required.

## Concurrent scheduling

The shared Vitest context now remains enabled when workspace concurrency is four.
Previously that setting silently reverted to separate workspace invocations.
Native tasks retain their own commands, lifecycle and owned-process cleanup.
Explicit filtered commands still use their native route.

An explicit CI group can share eligible workspace phases without also executing
the root suite. The child independently derives the group and verifies its exact
workspace arguments. Per-file isolation and the existing two Vitest workers remain
unchanged. Bash shard/concurrency variables reach only the native Bash unit task.

## Validation

- TDD: CI partition/admission controls and shared-context concurrency regressions
  failed before implementation; all 230 routing, admission, shared-runner and
  native lifecycle controls pass afterward.
- Three environment-routing controls pass after a red test demonstrated Bash
  shard settings leaked into non-Bash stages.
- Native lifecycle controls must be launched through npm so `npm_execpath` exists.
  An initial direct launch failed that prerequisite, not a product assertion.
  An initial static dependency introduced into the standalone runner also broke
  hermetic native controls; the final implementation keeps those controls intact
  and admits only exact supported cached command spellings without that dependency.
- A real local cold Turbo invocation ran the seven suites successfully in 13.805s;
  the next invocation reused the successful result in 2.390s. These are local task
  timings, not release timings or a cold-machine benchmark.
- Real Turbo dry reports include 74,100 tracked inputs in the initial candidate,
  including representative dependency source, tests, lockfile, configuration,
  helpers and cache policy. With identical file-input maps, changing only runtime
  identity changes the task hash. Membership and invalidation are not inferred
  from GitHub's outer archive key.
- Evidence: `/tmp/poe-ci-routing-red.log`,
  `/tmp/poe-ci-routing-native-fixed.log`, `/tmp/poe-ci-env-scope-green.log`,
  `/tmp/poe-ci-cache-cold.log`, `/tmp/poe-ci-cache-warm.log`, and
  `/tmp/poe-ci-turbo-runtime-{a,b}.json`.

## Delivery and measurement

Deliver the routing/cache foundation independently. The workflow integration then
creates a fresh build/smoke job, independent verification jobs using its same-run
artifact, bounded Bash shards, and a publishing job requiring every verification
job. GitHub cache hits must never bypass fresh safety checks or publish after a
failed shard. Preserve executable modes when transporting build outputs.

Run workflow lint rather than workflow unit tests. Measure a first cold run and a
same-revision warm workflow dispatch, recording actual job durations, critical
path, total runner time, and Turbo hit/miss counts. Keep failed runs visible; do
not rerun failures merely to manufacture a faster sample. No CI timing or release
success is claimed by this plan before the corresponding runs finish.
