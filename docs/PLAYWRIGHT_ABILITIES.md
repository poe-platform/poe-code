# Playwright client abilities

Safe Bash exposes the 92 commands defined by the pinned `@playwright/cli@0.1.20`
metadata, including its additional `config-print` and `tray` commands. Command
availability comes from client implementations, not a Cloudflare/Playwright
provider-name switch. Declaring an ability is the client's assertion that its
handler implements the advertised argument forms.

This is a complete extension surface, not 92 built-in browser implementations.
Installation, process management, dashboards, test debugging, recording, WebMCP
and arbitrary browser/code execution are never enabled implicitly.

## Selecting abilities

Both `createPlaywrightController` and `createPlaywrightCli` accept `abilities`.
Import the SDK, CLI plugin, catalog and types from
`@poe-platform/safe-bash/playwright` or `poe-code/safe-bash/playwright`.

- Omitted `abilities`: retain the existing injected browser adapter's built-in
  commands. Without an adapter, only controller-local `list`, `close` and
  `close-all` are available.
- Explicit `abilities`: the map is authoritative, with no implicit defaults.
  `{}` enables no commands. Help remains available.
- A value of `true` selects an existing built-in. Type checking and runtime
  validation reject `true` for commands without a built-in implementation.
- An object supplies `execute`, optional `scope`, optional `options`, and
  optional `limitations`. Only configured commands appear in global help.
- `options` defaults to no command-specific flags. Select known names such as
  `['domain', 'path']`, or use `'all'` to explicitly implement every pinned flag
  for that command. Unknown or duplicate grants are rejected.
- `limitations` adds a visible `[limited]` marker and explanation. Native
  built-ins retain their snapshot-ref and optional-target restrictions;
  replacing them with a client handler removes those built-in restrictions.

Help preserves upstream section ordering, command syntax and descriptions,
omits empty sections, and lists only configured flags. It never acquires a
browser. Help for a known but disabled command explicitly says it is not enabled;
executing that command fails before the client or browser is called.

`playwrightCommandCatalog` is immutable and exposes each command's `usage`,
`description`, `section`, `referenceLine`, `arguments`, `arity`, and `options`.
Option metadata contains its type, description, repeatability and optional-value
form. It can also
drive client configuration UIs. Argument values remain strings: backend-specific
value validation belongs to the implementing client.

## Client-owned backends

The default handler scope is `client`. It needs no browser adapter. The client
can implement commands through a remote service or its own retained session map.
Calls with the same selected session name are serialized; different session
names may run concurrently. Client-owned global operations must coordinate their
own sessions and resources. Controller disposal cancels and drains active calls
but does not invent a close/kill operation for client-owned idle resources.

```ts
const cli = createPlaywrightCli({
  abilities: {
    'webmcp-call': {
      options: ['params', 'frame'],
      async execute(request) {
        const result = await client.callTool({
          session: request.session,
          name: request.args[0],
          params: request.options.params,
          frame: request.options.frame,
          signal: request.signal,
        });
        await request.write(JSON.stringify(result) + '\n');
      },
    },
  },
});
shell.use(cli.plugin);
```

Here `client` is the host's implementation, not a bundled WebMCP runtime.
The same mechanism covers `attach`, `detach`, `run-code`, `install`, `kill-all`,
video, tracing, dashboards, debugger commands and every other catalog entry.
No guest text is evaluated by the framework and no host process is spawned.
The host must authorize endpoints, credentials, native paths and privileged
effects inside those implementations. A callback is trusted host code, not a
JavaScript sandbox.

## Borrowing a retained browser

Use `scope: 'session'` to borrow a context acquired by the existing `adapter`.
Select built-in `open: true` to create that retained session; a client-owned
`open` callback does not populate the controller's session registry. Managed
handlers do not create a second browser owner.

```ts
import type { BrowserContext } from 'playwright';

const cli = createPlaywrightCli({
  adapter,
  abilities: {
    open: true,
    close: true,
    snapshot: true,
    'cookie-list': {
      scope: 'session',
      async execute(request) {
        const context = request.browserSession!.context as BrowserContext;
        await request.write(JSON.stringify(await context.cookies()) + '\n');
      },
    },
    'state-save': {
      scope: 'session',
      async execute(request) {
        const context = request.browserSession!.context as BrowserContext;
        const state = await context.storageState();
        await request.writeArtifact(
          new TextEncoder().encode(JSON.stringify(state)),
          request.args[0] ?? 'state.json',
        );
      },
    },
  },
});
```

The example assumes `adapter` supplies actual regular Playwright contexts.
The base structural context deliberately has fewer methods; the host knows its
native context type and asserts it at its own adapter boundary. Cloudflare clients
can implement the same abilities using their own supported native context type.
Availability is never inferred from a cast or from provider branding.

`request.browserSession` contains:

- `context`: the borrowed context.
- `page`: the selected page, or `undefined` when no selected live tab remains.
- `resolveTarget(ref)`: resolves a valid current built-in snapshot ref.
- `selectPage(page)`: selects a page from this context, checks tab limits and
  invalidates old snapshot refs.
- `registerCleanup(callback)`: registers retirement work for this session, such
  as removing network listeners or routes. Cleanup starts before browser release
  and is drained together with release; it must tolerate the browser closing.

After a session-scoped custom command, built-in snapshot refs are invalidated.
Errors, cancellation and output failures retire the borrowed session, without
replaying the command. Use `request.registerCleanup` for invocation-only work.
The framework drains operations issued through its request helpers, even if a
handler forgets to await one. Retaining helper callbacks past completion is
unsupported and fails closed. Native browser objects remain trusted borrowed
objects; callers must not retain/use them beyond their session lifetime.

## Arguments, output and virtual files

Handlers receive the canonical `command`, selected `session`, positional `args`,
declared `options`, and an `AbortSignal`. Options are strings or booleans;
repeatable flags are readonly string arrays. Bare optional-value `--extension`
and `--skills` flags arrive as `true`, without a client-specific default being
invented. The install `-g` alias maps to its declared `global` option.
Input arrays/options are immutable.
Targets and program snippets are data: no implicit selector interpretation or
host evaluation occurs. Use `--` before literal positional values beginning
with `-`; negative numeric coordinates also work directly.

- `write(text)` emits text with backpressure.
- `readFile(filename)` reads owned bytes from the injected virtual-file source.
- `writeArtifact(bytes, filename?)` copies binary data before writing it. With
  no filename, the CLI writes bytes to stdout, supporting shell redirection.
- `registerCleanup(callback)` drains invocation-owned cooperative resources.

The CLI resolves paths against its virtual working directory. The SDK supplies
`readArtifact(filename, maxBytes)` and `writeArtifact(bytes, filename?)` on each
invocation; these are byte callbacks, not implicit native filesystem access.
The read callback must honor the supplied byte limit before allocation. Missing
sources/destinations fail explicitly. Uploads, state files, PDFs, traces, videos
and binary responses can all use this same transport.

## Configuration and lifecycle

The controller accepts `adapter`, `abilities`, and `limits`. The CLI additionally
accepts `replace` (default false) for command registration. Live `billing` remains
unsupported. The limits and defaults are:

| Limit | Default | Scope |
| --- | --- | --- |
| `maxSessions` | 4 | Concurrent controller-managed sessions |
| `maxTabs` | 16 | All tabs in a controller-managed session, including page-created popups; overflow retires that session |
| `actionTimeoutMs` | 30000 | Existing built-in browser action timeouts |
| `maxSnapshotBytes` | 262144 | Aggregate built-in snapshot UTF-8 output, admitted inside each frame before transfer |
| `maxSnapshotRefs` | 1000 | Retained built-in snapshot nodes, admitted before native element-handle extraction |
| `maxArtifactBytes` | 16777216 | Each artifact read/write |
| `maxCommandBytes` | 16777216 | Per-invocation aggregate text/artifact output (including help, version and response framing), custom-handler artifact input and generated code |

All limits are positive safe integers. These are admission/transfer limits, not
an isolation or memory ceiling for arbitrary client code. Client handlers must
honor cancellation and implement their backend's action timeout policy. Opaque,
uncooperative host work cannot be forcibly preempted by this library.
Budget failures produce a nonzero CLI result and a stderr diagnostic, including
in JSON mode; the diagnostic is not charged to the exhausted command budget.

Built-in snapshots require public frame `evaluateHandle`. They retain nodes in a
browser-side object and transfer only bounded status and rendered text; they do
not obtain locator element handles or transfer raw body text, attributes or input
values. Native element handles are acquired lazily when an action resolves a ref,
preserving node identity across DOM reordering. The snapshot budget does not bound
later native action traffic, page-side allocations or arbitrary provider messages.

Built-in screenshots require public page `evaluate` for bounded numeric geometry.
They capture at CSS-pixel scale with an explicit clip fixed to the observed viewport
or full-page extent. Raster admission allows at most `floor(maxArtifactBytes / 4)`
pixels, capped at 4,000,000 for PNG and 1,000,000 for JPEG (dimensions rounded to
8-pixel blocks for JPEG). Oversized extents are refused, not silently cropped to
fit the budget. Page growth after measurement cannot enlarge the admitted clip.
These conservative raster limits reduce native encoder/transport exposure; the
exact encoded-byte limit is still checked before writing an artifact, because
encoding overhead can exceed a small budget. Arbitrary custom screenshot providers
must honor the capture options; this is not a universal codec or host-memory bound.

The only environment variable read by the CLI is exported
`PLAYWRIGHT_CLI_SESSION`. Selection precedence is explicit `-s`/`--session`, then
that variable, then `default`. The SDK receives environment values explicitly;
the host process environment is not read. Help ignores invalid session environment
values because it does not select or allocate a session.

Always dispose the CLI/controller, and separately dispose client-owned resources.
No cross-process session persistence, privileged host installation or provider-wide
process killing is implied by configuring a callback.

### Cooperative transport interruption

An acquired browser resource may additionally supply `interrupt(): Promise<void>`.
The adapter starts this hook alongside context closure, waits for both operations,
then always calls and awaits the resource's `release()`. Concurrent release calls
share one completion. Interruption is useful when a broken browser transport would
otherwise prevent `context.close()` from settling. Hook failures are preserved;
neither a timeout race nor an abandoned close is treated as completed cleanup.

The hook must affect only the resource owned by that acquisition. For a borrowed
browser, disconnect only an owned connection, never terminate someone else's
browser. Omitting the hook preserves the existing context-close-then-release
behavior. Arbitrary uncooperative host callbacks still have no forced-preemption
guarantee.

For Cloudflare's session API, an opt-in host can use `acquire(binding)` followed
by `connect(binding, sessionId)`, retain the owned ID, and use that **connected**
browser's `close()` in `interrupt`. Its `release` must separately request session
removal over an out-of-band, deadline-aware service API. Do not substitute a
`launch()` browser's close: that path sends an in-band browser-close command and
can stall with the same transport. A partial acquisition also needs host-owned
cleanup of the retained session ID.

This separates local transport disconnection and draining pending operations from
remote session removal. A deletion acknowledgment or absence from a session list
does not prove the remote browser process has exited. See the pinned local-runtime
qualification and remaining deployment limits in
`docs/plans/playwright-resource-limits.md`.
