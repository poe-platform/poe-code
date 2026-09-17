# Owned Playwright session restoration

`createPlaywrightController` and `createPlaywrightCli` expose host-only
`restoreSession(options)` and `inspectSessions()` methods. They are not commands,
do not add guest options, and do not change `-s`, `PLAYWRIGHT_CLI_SESSION` or help.

The host persists an authenticated owner-to-provider mapping, reconnects its
provider transport, selects the existing context and page, and restores each live
record before admitting guest commands. Merely connecting a browser and calling
the generic adapter's `acquire` creates a new context rather than restoring one.

## Restore options

- `name`: the existing CLI alias, using the same validation as `-s`.
- `acquire({ signal })`: awaited host callback returning `{ lease, selectedPage }`.
  `lease` is the public `PlaywrightLease` for an existing context. It owns exactly
  the resources specified by the host's `release` policy. `selectedPage` is an
  optional existing member of that context; omission requires explicit tab
  selection before page actions. No page or context is created by restoration.
- `signal`: optional cancellation signal, borrowed only during restoration.
- `expiresAt`: optional absolute Unix timestamp in milliseconds. Expired records
  are rejected before acquisition; expiry is rechecked before admission and
  browser actions. Idle expired sessions are retired on the next controller
  command, not by a background timer. Provider TTLs remain the host's responsibility.

The callback is not called after invalid input, disposal, expiry or capacity
rejection. It owns partial acquisition cleanup until it returns a lease. Once
returned, the controller retires the lease on failed/cancelled restoration and
awaits cleanup, including late acquisition after cancellation. Accepted sessions
participate in the existing per-name queue, capacity, list, close, close-all and
controller disposal. Restoration never replaces an active same-name session.

`inspectSessions()` returns frozen host checkpoints containing each open session's
`name`, live `context`, optional `selectedPage`, and optional `expiresAt`. These
are live host references, not a serialized browser profile or credential export.
After awaiting a command, the host can translate them to its own persistent
provider/context/page identifiers. Inspection excludes closed/expired sessions.

Snapshot handles and refs are intentionally not checkpointed. Every restoration
uses fresh randomized numeric ref namespaces. Old refs fail with the normal
snapshot-again diagnostic, even after taking a new snapshot. Cookies and tabs
survive only by restoring the same provider context, not by exporting guest state.

## Ownership and recovery

Never look up an arbitrary provider ID supplied by a guest alias. Bind owner,
tenant and credentials in the callback closure, and enumerate only that owner's
persisted records. A stale provider ID must fail or be discarded by the host;
do not silently attach a different browser or recreate a session under old refs.
Provider authentication/transport failures from bootstrap are host errors and
must be sanitized before being shown to a guest.

The controller serializes its own session operations. The host must additionally
serialize ownership transfer across processes/controllers, for example with its
authenticated Durable Object or a storage lease. A persistent record alone is not
proof of exclusive ownership. Await bootstrap restoration before allowing list or
close-all, so these commands cover all restored records for that owner.

`dispose` retains its existing retirement semantics; it is not a keep-alive or
silent detach operation. A host choosing transport-only lease release must own
remote expiry/deletion separately. Transport loss and local lease retirement do
not establish that a provider browser has ended. No environment variables or
additional provider settings are read by these lifecycle methods.

## Cloudflare host configuration

With the qualified `@cloudflare/playwright` 1.3.6 client, a browser keep-alive
does not make a normal `newContext()` persistent: those contexts use
dispose-on-detach. A host retaining sessions across transport replacement needs
a persistent connection and its existing default context. The public URL-based
connection can be configured with `new URL(endpointURLString(binding, { sessionId }))`,
setting its `persistent` search parameter to `true`, then passing that URL to
`connect`. Restore `browser.contexts()[0]` and the previously selected existing
page; do not replace it with `newContext()` or `newPage()` during bootstrap.

This is an explicit host/provider configuration, not something a guest alias
can enable. The host still owns stale-ID handling, browser expiry and deletion.
The maintained real-browser fixture uses the public installed packages, Miniflare
4.20260708.1, its Chromium binding and an explicit `EVAL` binding. Its container
CI launch mode disables Chromium's internal sandbox for trusted fixture pages;
this interoperability test does not qualify untrusted guest isolation.
