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
