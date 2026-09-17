# Injected Playwright duration reporting

Public types: `virtual-bash/contracts/playwright` and
`poe-code/safe-bash/contracts/playwright`. This contract declares a future injected
capability. The existing `createPlaywrightAdapter` does not implement reporting.
No CLI/controller, timers, provider collector or billing runtime is supplied here.
Keep eventual feature logic in a focused Playwright package; safe-bash only wires
registration, VFS and streams. Creating that package and its README is deferred.

## Host configuration and authorization

`PlaywrightInjectionOptions` accepts an adapter and optional `billing` hooks.
When present, billing requires a caller-selected `intervalMs` and awaited
`onUsage`; `beforeAcquire` is optional and awaited. The host must validate that
the interval is a finite positive integer before browser effects; TypeScript's
`number` cannot enforce this. There is no default cadence or environment lookup.
These are all billing configuration options; no environment variables are exposed.

Create a stable, nonempty acquisition ID before authorization. Reuse it for
retries of the same attempt, including partial acquisition; different attempts
get distinct IDs. Await authorization once before each browser-creating attempt.
Rejection prevents allocation. Tabs and commands on an existing browser do not
create additional duration quantities. Bind customer identity through trusted
host injection or callback closures, never guest session names, arguments or
guest-supplied customer IDs. Shared resources require trusted attribution or
must be refused; charging their entire duration to multiple customers is unsafe.

With billing enabled, require `PlaywrightUsageAdapter` and forward acquisition
`usage: { intervalMs, report }`, awaiting `billing.onUsage` through `report`.
Its `liveBrowserUsage: true` declaration obliges the injected adapter to support
this whole contract. An unsupported adapter must reject billing configuration
before allocation. The existing factory must not advertise this capability.
Without billing, ordinary adapters remain usable. Absence of hooks does not
imply that provider resource usage is free.

## Resource lifetime and facts

Meter live browser duration in milliseconds, including idle time while open,
from actual resource start through confirmed resource end. Concurrency charging
is deferred. Resource IDs identify the billable browser, survive reconnects,
and are independent of tab, context and lease IDs. Reconnect must retain the
same cumulative baseline. Correlate facts with their originating acquisition ID.

Establish a stable host-correlated resource ID before browser-creating effects;
it need not be the provider's browser ID. Retain that ID when a partial acquisition
fails before the provider returns its identity, and bind later reconciliation
facts to it. If the adapter cannot correlate potentially incurred usage with a
stable resource identity, refuse reporting-enabled acquisition before effects.
An unknown acquisition outcome is not evidence that a browser was created or
that no usage occurred. Confirmed refusal before allocation needs no usage event.

`started` records start evidence; `usage` reports cumulative duration through a
timestamp; `ended` carries confirmed end and final cumulative duration; `unknown`
records unresolved lifetime. `usage.final: true` requires confirmed end and is
followed by `ended` with the same final total. Neither constitutes a second
charge quantity. Timestamps are UTC ISO strings: `observedAt` is observation
time, distinct from resource `startedAt`, `through` and `endedAt`.

Every fact has a stable event ID across retries and a positive integer revision
ordered per resource. New facts and corrections advance revisions. Cumulative
durations are finite nonnegative milliseconds, unrounded for pricing purposes.
Use a monotonic clock for estimates; wall-clock changes must not distort elapsed
time. `provider` accuracy requires qualified provider lifetime/usage evidence;
local clocks and unqualified session-history timestamps are `estimated`.
Unknown facts carry no invented duration or end timestamp.

Adapters must report periodically even between commands and before a lease is
published if allocation has already incurred usage. Metering must send no browser
commands, keep-alives or other traffic to preserve a connection or extend service
lifetime. Disconnect, context closure, release settlement and termination requests
are not proof of remote termination. On lost connection, failed partial allocation
or unconfirmed cleanup, report unknown and require trusted host reconciliation.
Later confirmed provider facts may arrive after controller disposal.

## Delivery, finalization and external accounting

Serialize and await callbacks per resource, with at most one in flight. Coalesce
slow-handler ticks into the next cumulative report, retaining elapsed duration
without an unbounded queue. Preserve lifecycle facts and final reports. Cadence
is cooperative, not a strict settlement deadline.

Callbacks must not await acquisition, release or disposal that itself waits for
reporting on the same resource; this would create a circular wait. Request such
lifecycle work after the callback settles. Serialization covers all reporting
for the resource, including reconnects and reconciliation, not just one lease.

The external host charges the delta from its last accepted cumulative total.
Duplicate event IDs, identical revisions and older revisions add no charge;
conflicting content at the same ID/revision requires reconciliation. Corrections
use new IDs and higher revisions and replace the prior accepted cumulative total,
reconciling the difference, including downward adjustments, rather than charging
the entire corrected total. Unknown facts require reconciliation, never an
assumption of zero usage. Durable acceptance and idempotency are host obligations;
this contract makes no exactly-once delivery guarantee.

Track the accepted duration separately from lifecycle revisions: started and
unknown do not reset the last accepted cumulative total. For example, accepted
usage of 1,000 ms, then unknown, then confirmed final usage of 1,250 ms leaves
250 ms to reconcile. A correction to 900 ms instead requires a 100 ms downward
adjustment. Ended confirms the final total and must not charge it again. An ended
fact received without its preceding final usage can reconcile that total once;
missing or out-of-order facts must not silently erase previously accepted usage.

After confirmed end, stop reporting ticks, drain the in-flight callback and emit
final cumulative usage including the last partial interval, followed by ended.
No late tick may extend duration past that end. Explicit close, confirmed expiry
and disposal use this same finalization rule. Unconfirmed end remains unknown.

An onUsage rejection prevents continued affected browser use, preserves the hook
error, and attempts and awaits owned cleanup even if reporting fails again.
Never terminate a borrowed remote browser. Cleanup failures must remain visible
alongside the hook failure. Stop and drain local reporting resources without
skipping browser cleanup or leaving unhandled callback rejections. Mark accounting
unresolved for the trusted host; a rejected callback cannot reliably receive its
own failure report. Cleanup latency may incur further duration. Use a host-owned
lifecycle deadline rather than only an already-aborted command signal. Never
retry browser actions to retry reports. Unconfirmed cleanup must not fabricate
final usage; reconciliation remains external.

Pricing, rates, balances, payments, persistence and charging are entirely external.
These declarations implement none of those concerns or the reporting machinery.
