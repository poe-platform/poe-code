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

## Qualified attachment routes

The opt-in `packages/safe-bash/tests/integration/playwright-private-target-transport.test.mjs` exercises the production source with two public attachment routes. The parent must register this exact new path in its integration-input inventory; that shared inventory remains outside this assignment.

- Local Playwright uses `chromium.connectOverCDP(adapter.transport)` directly.
- Installed Cloudflare Playwright 1.3.6 does not accept that object through its overridden `connectOverCDP`. Its public `connect(BrowserWorker, sessionId)` accepts a fetch binding instead. The fixture wraps that public binding's WebSocket upgrade in a native Workers `WebSocketPair`; one side is returned in a genuine 101 Response, and the other translates JSON messages through the adapter. This requires no private Cloudflare client import or property access.
- The Cloudflare route executes in local workerd with `nodejs_compat` and the explicitly required `EVAL` binding, and controls an independently launched real Chromium. It qualifies the client/transport boundary, not acquisition or deployment in managed Cloudflare Browser Rendering.
- Both routes verify existing/later init suppression, exact native context identity, shared localStorage/IndexedDB, concurrent and later public-page behavior, and normal/abort target destruction. Native `Target.closeTarget` acknowledgement can precede destruction; the fixture waits for the exact `Target.targetDestroyed` event before declaring release complete.

Run focused checks from the authorized worktree:

```sh
node --import tsx --test packages/safe-bash/tests/plugins/playwright-private-target-transport.test.ts
node node_modules/typescript/bin/tsc --noEmit --target es2023 --module nodenext --moduleResolution nodenext --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --skipLibCheck packages/safe-bash/src/playwright/private-target-transport.ts packages/safe-bash/tests/plugins/playwright-private-target-transport.test.ts
```

The opt-in native route requires explicit installed prerequisites and home-only scratch:

```sh
TMPDIR="$PWD/out/issue-746/chromium-hidden/tmp" \
MINIFLARE_WORKERD_PATH=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769/out/issue-769-verification/workerd-compat/workerd \
SAFE_BASH_CF_RUNTIME_ROOT=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769/out/issue-769-verification/runtime \
PLAYWRIGHT_TEST_MODULE=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769/out/issue-769-verification/runtime/node_modules/playwright-core/index.mjs \
PLAYWRIGHT_TEST_EXECUTABLE=/home/kjopek/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell \
node --test packages/safe-bash/tests/integration/playwright-private-target-transport.test.mjs
```

These paths name existing owner-provided tools, not dependencies installed or copied by the fixture. The optional loader wrapper is needed on this host because its system glibc cannot launch the installed workerd directly. Hosts with compatible libc need not set the override. The test reports actual runtime versions and skips rather than installing missing prerequisites.
