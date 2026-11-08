# Independent external-stdin holdouts: fixture freeze

Product is read-only. Ownership is only this new subtree and unique
`/tmp/shared-stdin-independent-*` scratch. No candidate was supplied or inspected.
In particular, live/candidate `src/shell/input.ts` has not been opened. Baseline
public contracts, package exports, shell entrypoint and standard handler helpers
were inspected using `git show eaed12f8:...`, not moving source inputs.

Baseline: `eaed12f88365e69597994c4f2e6324a020202b66`.
Author evidence: `28f13113fcc57c60f90cf385f33ccc58db580a06`.
Author harness: `8aa4db42a6ff22fabeea9057b7c111f1506490b9`.
The author's 34 observations (nine defective rows) and 63 unchanged tests are
historical context, not independent passes or candidate certification.

`cases.mjs` freezes 32 behavior identities and two negative-control identities.
`probe.mjs` freezes their executable expectations before any baseline execution
or candidate route. It uses binary chunks (including NUL and invalid UTF-8),
actual head handlers, custom registry commands and actual nested invocation,
concurrent sibling invocations, and both host and VFS cooperative retirement.
It does not repeat the author's grep/alias/column matrix or its builtin read
fixtures. Closely related contract boundary checks are intentionally retained.

Normal awaited owning-return failure must surface, even after command status 17.
Primary execution rejection and exact caller reason 0/Error take precedence.
`readBytes` at ordinary EOF need not call return; the outer shell owning close is
a different layer. Deferred unregistered return may be awaited ordinarily but
must remain interruptible by disposal. Opaque pending async-generator next/return
does not imply retirement before public abort/dispose. Explicit registered
cooperative cleanup does delay exec and concurrent disposal. No stronger opaque
retirement contract or new awaiting is imposed.

Readiness gates and event-loop checkpoints drive assertions, not sleeps. Each
probe runs in its own strict-unhandled-rejection child. A generous 60-second
parent watchdog kills only its exact child PID and treats expiry as failure,
never a waiver. Probes create no servers, workers, or child processes. All
controlled promises have explicit cleanup release; parent awaits child closure.
Negative controls execute only after the frozen baseline cohort: the existing
benign deferred-return case gains a deliberate swallow adapter; the existing
late-rejection case gains an unobserved promise fork. Neither changes production
nor adds risky native/regex/performance workloads.

The replay runner will archive exact committed production inputs, authenticate
Git blobs and development tools, compile, npm-pack, move into a separate public
consumer, and record package/build/loaded-module SHA256 manifests before and
after. Inventory comparison includes newly added entries. No live dist reuse,
dependency install, canonical evidence overwrite, or global tests are permitted.
Any fixture repair must be separately documented and committed without erasing
the original failing observation or silently weakening an expectation.

Only `/tmp/shared-stdin-independent-coordination.txt` can route a future exact
candidate; absent an explicit route, the bounded baseline ends in WAITING, not
acceptance. Runtime source ownership remains Plato/root.
