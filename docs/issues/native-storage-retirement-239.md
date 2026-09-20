# Native storage retirement investigation (issue 239)

The private-target CDP transport previously treated every internal detach error as
a fatal transport failure. A `Target.detachedFromTarget` or
`Target.targetDestroyed` event can confirm retirement before Chromium replies to
the pending detach with `-32602: No session with given id`. Closing the shared
transport in this case also closes public browser contexts and prevents their
storage checkpoints.

Three deterministic regressions reproduced this behavior against the current
source: session retirement, target destruction, and retirement replayed from the
creation buffer. Each failed before the fix because the upstream transport closed.
After the fix, public `Storage.getCookies` commands remain usable in all three.

Pending internal detach commands retain the session and target identity plus
matching retirement evidence. Only the exact native missing-session rejection
with that evidence is accepted. Unconfirmed retirement, unrelated retirement,
other errors, malformed envelopes, and foreign response sessions remain fatal.
Retirement evidence lives with bounded pending commands rather than depending on
the lifetime of the bounded retired-identity history.

The original poe2 Bun 1.4.2 failure has not been reproduced in this checkout.
These regressions establish a concrete closure path, but do not establish the
frequency or cause of that consumer failure or a regression in safe-bash 0.1.702.
The native qualification test requires a separately provisioned runtime and was
skipped locally; it is not counted as a pass.

## Earlier local native verification


The reported macOS/Bun consumer failure does not establish a regression in
safe-bash 0.1.702. Its original logs and Bun 1.4.2 were unavailable in this
checkout. The repository's unchanged native `two-replacements` scenario passed
on the committed baseline.

## Validated failure path

The owner control connection can close a private storage target while the public
connection still has an automatic attachment awaiting detachment. Chromium
153.0.8010.50 returns the native CDP error
`{"code":-32602,"message":"No session with given id"}` when that session has
already disappeared. The baseline private-target transport treats this as a
fatal detach failure and closes the public connection, invalidating its contexts
and subsequent storage checkpoints.

A local native probe held the public connection's real detach command until
the owner had closed the private target and destruction was observed. Against
the baseline it produced `Native private target detach failed` and transport
closure. Against the fix it produced the same Chromium error, no transport
closure, and a successful public `Storage.getCookies` reply. This validates a
context-disconnection mechanism; it does not prove that this ordering caused the
original consumer failure or measure its frequency under contention.

## Change and verification

Internal detach commands retain the private session identity they retire. The
transport accepts only Chromium's exact redundant-detach error, with the native
reply shape, after confirmed retirement of that session or its target. Other
errors, unknown retirement, and parent-session failures remain fatal. No retries,
quarantine, timeout increases, or synthetic public success replies were added.

Three regression tests failed before the fix for target retirement, session
retirement, and a late attachment after destruction. Additional negative cases
preserve fatal handling for unrelated retirement and unexpected errors.
The surrounding storage, target-control, and session-restoration tests passed.

The native replacement, same-context load, checkpoint census, and control-EOF
scenarios all passed after the fix using Cloudflare Playwright 1.3.6 and
Miniflare 4.20260708.1. This was local Chromium/workerd verification, not managed
Cloudflare or the original poe2/Bun consumer. Temporary fixture output was
transpiled from this checkout's sources and used the declared public entrypoints;
the normal guarded workspace build could not resolve its expected public
Playwright declaration through this checkout's linked dependency installation.
