# Reject cyclic snapshot backing references

Direct restoration of malformed backing references recursed until the native
stack overflowed. The shared-memory audit first reproduced the problem for
shared buffers. An independent ordinary-ArrayBuffer test then reproduced it
with only the new cycle guard temporarily removed: two failures, one positive
property-cycle test passing (session 80591).

Track heap IDs while resolving backing references, reject reentry with TypeError,
and remove the ID in finally. Ordinary property cycles remain supported because
their deferred restoration occurs after storage allocation. Keep this guard
independent of the unfinished SharedArrayBuffer integration.

Before the baseline recheck, the focused ordinary tests passed three cases,
shared/ordinary/detached snapshot checks passed 61 cases, and the shared snapshot
and guest checks passed 55 cases. Scoped lint and TypeScript passed. The maintained
selected SafeJS workspace build completed 23 builds and four fresh-import tests
(session 1890). These checks ran in the integrated working tree, not an isolated
checkout of this commit. Releases and pushes remain paused.

After reinstating the guard, the final ordinary-buffer, detached-buffer and cycle
regression group passed all 39 cases (session 46287).
