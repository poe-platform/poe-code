# Issue 669: portable-default API and compatibility plan

## Request and validated starting point

Issue #669 is a new API request, not a reopening of #649 or a proposed fix for
#662. The ordinary public import must supply the complete command preset with a
built-in bounded provider, accept an explicit override, and load in actual
workerd, browser, Node, and Bun environments.

Current source already implements `createBoundedRegexProvider()`. Reuse its
bounded ERE implementation rather than inventing a native-RegExp timeout fallback.
The current default preset instead constructs Node worker executors. The portable
preset requires an injected provider, and its bundle still permits several Node
builtins. Therefore changing only a function default does not complete this issue.

A current built-public regression also reproduces the reported mixed-entry bug:
browser `Shell` plus portable commands fails nested `env` and `xargs` with
`Expected owned command arguments`; the same portable entry succeeds. Independent
bundles duplicate the argument-carrier identity registry. Preserve strict branding
and share the actual module graph rather than introducing an ambient global registry.

## Delivery sequence

1. Deliver independently validated, nonbreaking corrections first: shared browser
   and portable runtime identity, optional portable-preset provider, and an explicit
   Node regex-provider factory. Keep #669 open until the complete acceptance matrix
   passes; these milestones alone are not portable-default completion.
2. Make the ordinary public entry use the complete environment-neutral preset.
   Export its factory as `agentCommands`, with optional `regexExecutor` injection.
   The requested public executor abstraction is not interchangeable with the
   existing worker-shaped provider; adapt that protocol internally while keeping
   its bounded execution, cancellation, and borrowed-ownership contracts. Keep
   `/portable` as an alias of that same runtime, not a second bundled identity.
3. Preserve the former Node-root surface behind an explicit `/node` entry. Existing
   Node consumers needing the previous factories, filesystem adapters, or regex
   behavior can migrate their import to `/node`; consumers of the new common entry
   can explicitly inject the Node regex provider from that host-specific entry.
4. Remove unavailable host modules from the default runtime graph. Audit every
   reachable command, including checksums, compression, archives, timers, and paths;
   any required portable implementation or dependency needs its own validated
   boundedness and compatibility evidence. A browser build with Node polyfills
   silently supplied by the test harness is not sufficient acceptance.

## Explicit compatibility and versioning boundary

The shared-runtime correction and optional `/portable` argument are additive.
Switching the ordinary root export and its default regex dialect is not additive.
Do not publish that switch as an unannounced `0.1.x` patch: the scoped package train
must cross an explicit `0.2.0` minimum version boundary, and the corresponding
`poe-code/safe-bash` change requires a declared breaking release of the CLI package.
Verify registry versions and release configuration before enabling that boundary.

The migration document must identify the root exports moved to `/node`, give old
and new import examples, retain existing `/portable` usage, and distinguish the
bounded default dialect from the explicit Node provider. Do not remove old native
implementations or silently relax their existing regression assertions.

## Invariants and acceptance evidence

- Retain the independently declared complete 79-command inventory. Apply provider
  injection consistently to `grep`, `rg`, `expr`, `egrep`, and `fgrep`; do not create
  separate environment-specific command lists.
- Preserve input, output, work, allocation, queue, and worker bounds; cancellation,
  unsupported modes, cleanup precedence, and original abort identities remain
  explicit contracts. Document restricted modes instead of claiming native parity.
- Default executors own their endpoints. Injected provider objects remain borrowed;
  shell disposal must not dispose another caller's provider or sibling endpoints.
- Networking, host execution, filesystem authority, and interpreter runtimes remain
  explicit opt-ins. Portability does not grant capabilities or host-JS isolation.
- Add failing regressions before product changes. Cover default construction,
  injected-provider routing, aliases, nested invocation, shared-provider ownership,
  limits, cancellation, unsupported modes, and explicit Node behavior.
- Verify maintained build, strict declarations/consumers, lint, and unit routes.
  Exercise installed public artifacts in actual Node, Bun, workerd, and a browser,
  including representative workflows across every command family. Inspect an
  actual browser screenshot; do not substitute a bundle-only result for runtime QA.
- Record local commits, verified remote-main delivery, and successful publications
  separately. Close #669 only after all requested behavior is delivered; continue
  other eligible issues while release workflows run.

## Status

Implementation and acceptance are in progress. No portable-default root switch or
breaking publication is represented as completed by this plan.

## Additive milestone integration, September 8, 2026

The candidate shares emitted browser/portable chunks, permits omitted portable
provider options, and adds the explicit `/node` entry and Node provider factory.
The root default and release-version policy are deliberately unchanged at this
stage. The public mixed-entry fixture was moved to
`scripts/fixtures/safe-packages-mixed-entry-runtime.mjs` so maintained tarball
consumer checks copy and execute it too.

Root integration reproduced three build-driver failures from the old single-entry
output assumption, then updated joint-output publication and its mock model.
The four focused bundle/package/publication files now pass all 30 tests. The
Node-global-free VM fixture rebundles only emitted browser artifacts in memory,
including shared chunks; it does not fall back to source or disk modules.

Review also reproduced one invalid-provider regression: explicit `null` silently
selected the default. A failing assertion preceded the correction to default only
on `undefined`. The eight focused preset/provider/portable files pass with normal
per-file isolation. These are eight passing file summaries, not eight individual
behavior cases. The Node provider test now explicitly narrows optional worker
resource-limit metadata without weakening its value assertions.

The maintained runner initially failed because sandbox policy denied child
processes and a loopback fixture socket (`EPERM`). Those diagnostics are retained
separately. The unchanged maintained command with required access passes all
282 runner checks. Full build, strict typechecking, guarded lint, full unit work,
installed Node/Bun/workerd acceptance, remote delivery, and publication remain
pending; none is inferred from these focused results.

## Author clarification and integrated acceptance

The issue author's September 8, 2026, 16:30:31 UTC clarification supersedes the
earlier compatibility proposal: breaking refactoring is permitted without aliases,
a deprecation window, or a required major release. The next default-entry change
uses `regexExecutor?: BoundedRegexProvider` directly. Issue #669 now targets
workerd with `nodejs_compat`; the remaining zero-Node full-inventory work is #672.
The earlier version-boundary section records the previous proposal, not a current
delivery prerequisite. The additive corrections can ship independently first.

The integrated #669/#670 candidate builds and passes strict SafeBash consumer
types and the maintained repository lint route. Fresh installed local tarballs
pass Node and Bun public smoke, public declaration checks, and the unshimmed
browser bundle. Actual workerd passes nine browser/no-compat cases and 22 cases
each for mixed-entry default and injected portable providers with compatibility
enabled. This includes nested env/xargs and bounded expr matching, captures,
anchored nonmatches, unsupported modes, and help. Runtime instances are disposed.

Packing exposed a POSIX export regression; the preserved RED and corrected
public-consumer checks retain the complete existing portable path API. Full unit
validation then exposed a test-only export-mirror assumption that every condition
is a string. It now preserves and explicitly asserts the Node entry's `browser:
null` denial. The preceding shared unit phase passed 20,242 tests; that phase is
not a claim that the full test route passed. Final full validation and delivery
are recorded separately in the issue and retained gate receipts.
