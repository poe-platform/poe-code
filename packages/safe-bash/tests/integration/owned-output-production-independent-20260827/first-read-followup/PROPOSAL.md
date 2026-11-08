# Proposed canonical first-read profile — NOT APPLIED

Root approval of exact implementation hunks is still required. This is test-only
adoption of the accepted optional destination-owned contract, not permission for
a runtime/contract change or a claim that the original five requirements became
five passing unchanged tests.

## Exact proposed write-set

1. `tests/shell/first-read-probe.ts` — narrow scenario/signal/witness changes at
   the current `observed` variable, pending-stream registration, middleware
   signal capture, and post-exec assertions around lines98–108. Keep head-zero
   and S3 commands, bytes, result assertions and counters. Keep the original
   `first-read-local` branch available as an explicit historical reproducer;
   do not change it to secretly enroll or release its source.
2. `tests/shell/remote-close.test.ts` — only its first-read scenario entries:
   preserve the19 unrelated scenarios and existing head-zero/S3/HTTP names;
   propose replacing **one** local automatic-preemption expectation with the
   explicitly named `first-read-local-unenrolled-controlled` and adding
   `first-read-local-owned`, `first-read-webdav-body-acquired`,
   `first-read-curl-body-acquired`, `first-read-required-destinations`.
   Supervisor, output bound, exit/resource checks and canonical discovery remain.
3. NEW `tests/shell/first-read-owned-fixtures.ts` — maintained typed, per-child
   signal/resource observers and controlled gates, imported by the probe.
   Restore fetch/prototype hooks in finally, bound journals, observe actual
   request/reader close without adding reads, and expose explicit cleanup phases.
   No default evidence-file writes and no fixture-local package declarations.

No other files: **not** shared remote fixture helpers, production source,
contracts, package exports, tsconfigs, root discovery, existing sealed data,
AGENTS or native profiles. A later evidence-only commit should retain the exact
old six-case replay beside revised profile results. No whole-file exclusion or
blanket skip/TODO is proposed.

## Local profile decision needing explicit root approval

The old local handler receives `registerCleanup` and stdout.ownedOutput but uses
neither. Automatic cancellation of its whole-context pending read is not provided
by the accepted opt-in contract. Merely registering source.return also does not
connect downstream closure to that pending read.

Minimum supported producer adoption, proven by NEW observer bindings:

```ts
const operation = createOutputOperation(context, context.stdout);
try {
  const source = await operation.acquire(
    signal => pendingSource(signal),
    source => source.return(),
  );
  await pipeBytes(source, operation.output, operation.signal);
} finally {
  await operation.close();
}
```

The command still handles expected operation EPIPE separately from caller abort;
caller reason takes precedence. Resource construction/admission happens inside
acquire, whose release is registered first. Do not add a probe read or use whole
caller cancellation to finish this fixture.

For unenrolled behavior, assert pending before a controlled host release, caller
live, then finalization/public settlement after that release. Keep the old1200ms
deadline observation as historical/raw automatic-preemption evidence. Replacing
that single canonical expectation is an **explicit contract/profile and input-
schedule migration**, not a source fix. If root declines this profile migration,
retain its canonical failure; do not hide it through discovery changes.

## HTTP assertion changes and stronger controls

- Replace ambiguous `observed` with separately named caller, command, destination
  and operation/transport signals. Original commands, policy, server GET setup,
  exact stdout/stderr/status, read1/return1/active0 checks remain otherwise intact.
- At public settlement, assert owned operation EPIPE while caller stays live;
  whole-context abort must not be required for destination closure. For the
  required-file/header/stderr control, explicitly verify those bytes/effects
  survive stdout closure rather than merely inspecting a signal.
- For original HTTP recipes, do not require a body reader/response to exist:
  the captured server headers do not establish client acquisition. Assert the
  admitted fetch/request has settled and registered client cleanup has finished.
  A no-response curl has0 response disposals, not an invented required1.
- Add separately named body-acquired cases. The downstream gate must wait for
  the **GET** reader or response-body first read, not a PROPFIND reader or server
  `flushHeaders`. Assert no outstanding read, reader lock release or response
  iterator return/disposal, and actual owned-client close before public settlement.
  Distinguish settled EPIPE cancellation rejections of an already errored stream
  from fulfilled cancellation; arbitrary cleanup errors must still fail.
- Preserve a bounded **passive** wait for the remote server response to close
  after public settlement and before Shell.dispose/harness cleanup. Do not
  require a remote socket event to have arrived synchronously at client settlement.
  Fail on deadline; do not abort caller, destroy server sockets, or call dispose
  to rescue that assertion. Record every release/forcing action.
- Add nearby negative controls: cleanup registration without enrollment remains
  pending; dropping the owned sink capability prevents the enrolled guarantee;
  redirecting observation back to whole context fails; a deliberately withheld
  cooperative release keeps public settlement pending; premature server teardown
  must not satisfy the passive-close assertion. These are required future
  validation controls, **not claimed executed by this observational sidecar**.

Before applying: root confirms this exact three-file scope and explicit local
profile migration; a different verifier checks generated hunks/unchanged inputs
and executes the revised cohort. Poincare's runtime.ts/shell.ts remain off-limits.
