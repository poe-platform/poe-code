# Host Instant structured-clone admission gap

## Validated current behavior

A read-only Node 26.8.1 source-runtime probe (707e39) constructs both a
temporal-polyfill Instant and a native Temporal.Instant, then calls
cloneSandboxValue(value, { structuredClone: true }). Both are accepted.
Native structuredClone of the same native Instant throws DataCloneError.

The uncommitted Instant import branch in values.ts reads the host epoch,
creates an owned Instant, then explicitly returns it in structured-clone mode.
The earlier private-brand rejection only catches already guest-owned Instants.
Other Temporal host-import branches explicitly reject structured cloning.
This is an uncommitted integration defect, not a verified released regression.

The existing temporal-instant-structured-clone tests cover guest values, nested
guest values, subclasses, removed prototypes, transfer rejection and ordinary
owned copying. The native Instant tests cover ordinary import/export, bindings
and forgery rejection. Neither covers this host-import clone-mode case.

## Cross-type controls

A second read-only Node 26.8.1 probe (1dcd03) checks all eight Temporal types
from both the backend and native namespaces. Ordinary imports accept all sixteen
samples. Structured-clone mode accepts only the two Instant samples; Duration,
PlainTime, PlainDate, PlainDateTime, PlainYearMonth, PlainMonthDay and ZonedDateTime
each reject with DataCloneError for both sources. This narrows the observed
admission defect to the Instant branch, rather than all host Temporal imports.
These are representative admission controls, not complete transport, private-
field fidelity or calendar-range qualification.

## Repair after frozen gate

Do not change runtime/test sources while full package session 36884 is running.
The mid-run fingerprint remains identical to the pre-run fingerprint (20fe29).
Once that run is terminal, add failing host/backend and native Instant clone
regressions, including nesting and a passing ordinary-copy control. Reject
structured cloning before allocating an owned copy and preserve normal import
semantics. Verify other Temporal host-copy branches while reconciling transport.

The full gate still has no terminal totals. This document records a validated
next repair, not a fix or a clean qualification. No push, release or issue
closure under the release hold.
