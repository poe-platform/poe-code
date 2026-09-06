# Network execution deadline

Network commands remain explicit opt-in. `NetworkCommandsOptions.limits` accepts
`maxTotalTimeMs`, a positive safe integer in milliseconds. Its default is
120,000; `cloudflareWorkerNetworkLimits` sets it to 10,000. Invalid values are
rejected by the same host-limit validation as the other positive network limits.
The host owns this policy; no guest flag increases or resets it.

## Scope and clock

Each curl command factory keeps a private weak association from the borrowed
`CommandContext.executionScope` object to one monotonic starting time. The
identity carries no mutable budget authority and is never modified. The
association contains no timers, listeners, responses or cleanup callbacks.

The clock starts when the first valid network invocation is admitted, after
argument validation and help/version handling, before authorization or transport
work. Help and rejected arguments do not start it. It measures elapsed monotonic
time from admission, not a sum of independently reset URL budgets or a stopwatch
that pauses between commands. Wall-clock adjustments do not extend or consume it.

All URLs, retries, redirect hops and sequential or parallel curl invocations in
the same `Shell.exec` share that starting time. Each execution has its own frozen
empty identity, including concurrent executions on one Shell. A later invocation
in an exhausted execution cannot authorize or dispatch another network request.
Another `Shell.exec` starts fresh at its first network admission.

Direct/custom hosts omitting `executionScope` get a new scope per curl invocation;
all URLs in that invocation still share its aggregate deadline. They may instead
explicitly share an object. Separate command factories retain separate host
policies even if passed the same identity.

## Per-URL limits and reporting

`maxTimeMs` and guest `--max-time` retain their per-URL semantics, including retry
and redirect work within that URL. An active operation's timer uses the smaller
of the remaining per-URL time and aggregate time. `maxTimeMs` retains its existing
2,147,483,647 ms maximum, so even a safe-integer aggregate larger than that cannot
overflow a Node timer. Authorization and subsequent request admission also check
the monotonic remainder rather than relying solely on a pending timer callback.

Expiry selects curl timeout status 28 and stops later URL admission. The deadline
signal bounds authorization, transport, upload/body consumption, retry waits and
output backpressure. Header output, write-out output and diagnostics use bounded
output operations too; response cleanup cannot silently give them a fresh full
timeout. The existing diagnostic escaping helper remains authoritative, and
payload bytes are not transformed into display text.

After expiration, a final timeout diagnostic or write-out may still be attempted
without admitting network work. Its timer is scheduled with zero remaining time:
an immediately completed sink can receive the report, but a stalled opaque sink
is cancelled on the next timer turn. This is best-effort reporting, not additional
network budget or a promise of instantaneous settlement. Host timer scheduling
and synchronous JavaScript cannot be preempted by this API. Silent mode can omit
the diagnostic altogether.

## Ownership and outcome selection

Each active timer belongs to its existing invocation/output cleanup operation.
Normal completion, timeout, downstream closure and caller cancellation clear it.
No timer remains between curl calls, and no per-execution list of callbacks grows
in the weak deadline state.

Caller or runtime-control cancellation retains its original reason, including
falsey values, rather than becoming timeout 28. Curl rechecks the original signal
after cooperative cleanup settles, including when cleanup rejects. Without that
original cancellation, cooperative cleanup failures still escape with their
original identity, including falsey reasons. The Shell's existing cancellation
and fatal-control outcome selection remains unchanged.

Already admitted cooperative acquisitions and registered cleanup still drain.
A response acquired after cancellation is disposed exactly once before the
invocation settles. The deadline does not forcibly terminate opaque host work,
discard late acquisitions, skip cleanup, undo completed effects or guarantee a
maximum settlement time for an uncooperative transport or cleanup callback.
Awaited writes retain backpressure, and body-loop yields check the original
command signal so the runtime's shared CPU checkpoint remains active.

The network deadline supplements, rather than replaces, Shell wall-clock, CPU,
output, URL-count, redirect, retry and payload limits. The default 30-second Shell
wall clock already bounds ordinary executions; the independent network deadline
also applies when a host raises that wall-clock allowance.
