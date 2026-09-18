# Private Playwright target transport

## Scope and integration

Implement a portable object-message CDP transport adapter in the issue-746 worktree. The parent owns registry acquisition, target creation serialization, network policy, exports, and integration-test admission. Do not modify those shared files.

`createPlaywrightPrivateTargetTransport(upstream, limits?)` returns `{ transport, beginCreation }`. The transport implements the public in-process CDP transport shape: optional `open`, `send(object)`, `close`, `onmessage`, and `onclose`. Each synchronous creation guard exposes `commit(targetId)`, `rollback()`, and `fail(error)`.

The host acquires the guard before dispatching native target creation and commits only the exact successful native target identity. Rollback is permitted only before dispatch or after definite rejection. Unknown outcomes must fail the transport, not replay possibly private targets. The parent serializes creation; nested guards are rejected. Guard failure closes this client transport and notifies its owner; the owner must retire the associated browser session/policy. The adapter does not acquire browser deletion permissions itself.

## Implementation contract

- Hold native target events and Target-domain replies together until identity is known; preserve unrelated ordering and response IDs across sessions.
- Hide exact owned target discovery/info/destruction and associated session traffic; filter native target-list replies. Detach the client's private native session using real CDP commands and real acknowledgements. Never pretend that script registration succeeded.
- Bound serialized message bytes, pending command count/bytes, held event count/bytes, and private target/session identity counts. Timers cover unresolved creation and every forwarded/internal command.
- Retain target/session tombstones until transport retirement so late traffic cannot re-expose an identity. Capacity exhaustion is explicit, not silent eviction. Retire on command timeout, detach failure, malformed input, upstream failure, or unresolved hold overflow.
- Remap command IDs monotonically without reuse. Ignore duplicate/late replies for completed issued IDs; reject never-issued responses. Close once, clear timers/accounting, and ignore post-close callbacks.
- Own retained JSON messages independently of caller mutation. The upstream must admit raw messages before decoding; object-message accounting is not a hostile-JavaScript heap sandbox.
- No Node globals/imports or dependencies in implementation. Caller-owned transports provide environment-specific WebSocket adaptation.

## Validation plan

1. Reproduce the missing isolation with focused pass-through tests, then implement against deterministic node:test timers and protocol fixtures.
2. Cover guard lifetime, ordering, exact identity/session scope, native detach success/failure, budgets, cancellation by owner failure, late replies, and idempotent retirement.
3. Qualify the current production module in installed Chromium with actual same-context localStorage/IndexedDB, existing/later init scripts, unrelated tabs and concurrent page creation, and owned cleanup.
4. Bundle and execute the production module in local workerd using real Workers WebSockets, and inspect/test the installed Cloudflare Playwright binding path separately from local Playwright. No deployment claim without owner-authorized remote execution.
5. Run focused source/test type checks and diff checks. Commit only owned new files. Parent registers any maintained integration path, integrates exports/registry and performs root gates/publication.

## Delivery limits

The adapter must be installed at initial client binding. An independent unfiltered client can still register scripts; hiding events on the policy connection cannot shield another client. Scratch storage must remain host-owned, script-disabled, and network-policy controlled. This transport is not a general adversarial CDP authorization boundary. Creation-time browser retirement, reconnect ownership, and full canonical backend behavior require parent-level integration qualification.
