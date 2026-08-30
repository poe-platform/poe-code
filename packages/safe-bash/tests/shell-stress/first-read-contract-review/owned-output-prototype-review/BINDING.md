# Declaration-only binding freeze

Independent intentions were committed as `f412eec` before this declaration was
read. Its seal SHA-256 is
`aabc0ea5c7d7f03b4c4038b3c94952e7a08d9c98e2d40b9dbbf76417503be972`.
The root coordination note explicitly permitted declaration-only reading after
that freeze. The declaration is v1 with its pre-implementation v1.1 transport
addendum; exact bytes and SHA-256 are retained separately. No author source or
test body is used here. No implementation or candidate API was verified.

## Exact binding choices

- Bind the declared `createOutputOperation(context, destination)` factory with
  the **actual** context and destination; no new context signal, fake sink, global
  controller, zero-byte probe write or deferred source-start gate.
- `destination.ownedOutput?.consumerClosed` is the declaration's notification
  capability. `ownedOutput.write` is its separately accounted write path. A
  transparent wrapper must forward both; only candidate execution can prove it.
- Use `operation.signal` for owned acquisition/read/request only, and
  `operation.output` for its output writes. Keep `context.signal` for independent
  stderr/files and preserve caller identity separately. Actual module/export
  location is **unbound** because the declaration does not provide one; do not
  invent a root export or import live source.
- Construct before acquisition so the declared implementation registers
  `operation.close` with the existing context cleanup hook synchronously. Use
  `operation.acquire(start, release)` for owned resource acquisition and the
  same `operation.close()` in finally. Release callbacks are idempotent.
  Separate admitted cooperative releases from opaque start promises.
- A sink with no `ownedOutput` has explicitly absent close-notification. The
  declared factory may still provide caller-only cancellation/cleanup. H15
  accepts this declared fallback, not invented downstream-close support; plain
  sink writes must positively work. No new `supported` boolean is invented.
- The declaration maps unhandled operation EPIPE to producer status 141 and
  permits a command to catch it and continue independent work. The local
  instrumented handler intentionally catches EPIPE, records stage/caller
  liveness and performs frozen independent effects before returning 0. This is
  **not** the unchanged original producer. Existing 141 controls still must run.
- For mixed curl outputs, the declared request lifetime remains caller/transfer
  owned while any body/header file is needed; stdout writes are separately
  enrolled. The independent frozen requirement is necessary file/header
  completion even if stdout closes preheaders. Exact curl command result cannot
  be inferred merely from this declaration's general EPIPE rule: preserve raw
  result and require the author/root to identify its declared late-write policy
  before execution. The already frozen H09-H11 admissible statuses are not
  expanded. A 0 status cannot excuse suppressed diagnostics or missing effects.
- `HttpRequest.registerCleanup` v1.1 forwards existing invocation ownership for
  cooperative Node request/socket cleanup before `http.request`. No released
  type/API or arbitrary transport cleanup support is inferred. The copied curl
  tests must exercise this with actual task-owned loopback requests.

## Intentional original-five changes, not yet executable patches

The five old fixture bytes remain the accepted archive bytes referenced by the
intentions manifest. Their desired exact changes are: explicitly enroll the
owned operation before each owned I/O start; pass its signal and output to that
I/O; retain synchronous cleanup ownership; replace stage-aborted assertions with
operation-aborted/stage-live/caller-live assertions. Keep each exact original
start barrier, command, source/request count, 1200ms deadline, teardown checks,
stdout/stderr/status and original failure evidence. Keep HTTP request counts
distinct from body iterator counts.

These are binding intentions, **not a claim that an exact adapted-original
patch has already been constructed**. The author/source-ready gate is absent;
the immutable candidate/export/test paths are unknown. A successor must retain
and separately seal the exact old-to-adapted fixture patch, import binding and
any instrumentation after authentication, before running it. No author-side
producer changes can silently replace these frozen requirements.

`binding.mjs` freezes a concrete extra H01 operation/stage separation probe
using the declared factory injected by the eventual authenticated driver.
It is not an original fixture replacement or an independent product test until
that driver invokes it through actual copied Shell/kernel/VFS execution.
`support.mjs` supplies trace/deadline/observation validation only. Scaffold checks
of those assertions are never counted as product passes or source mutations.

## Gate status at this binding phase

Root ready was unavailable after declaration inspection. The author source,
test bodies, patches, compiler hashes and evidence commit remain unauthenticated
and uninspected. An author declaration is not author CLOSED. Finite preparation
must finish and exit if that remains true; a fresh execution leaf may continue
without changing `INTENT.md`, `holdouts.json` or their original seal.
