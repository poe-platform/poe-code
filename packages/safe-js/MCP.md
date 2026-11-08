# Managed MCP capabilities

SafeJS includes stdio and streamable HTTP transports through tiny-mcp-client.
Nothing is connected or registered by default. The host grants named servers;
scripts select names rather than supplying commands, credentials, or URLs.

```ts
import { makeMcpModule, run } from "poe-code/safe-js";

const mcp = makeMcpModule({
  servers: {
    docs: { url: "https://docs.example/mcp", headers: { Authorization: "Bearer token" } },
    files: { command: "/usr/local/bin/mcp-files", args: ["/workspace"], env: {} }
  }
});
await run('import {servers} from "mcp"; return await servers.docs.tools();', {
  modules: { mcp }
});
```

Scripts can also use `const docs = await client(server("docs"))` or
`await client("docs")`. Unknown names and forged handles fail before connecting.
The `servers` registry contains client methods, not transport configuration.
Mutating the script's copied registry does not reconfigure the host.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `servers` | Required | Map of names to stdio or HTTP configurations. |
| `requestTimeoutMs` | 30000 | Positive integer deadline for each protocol request and HTTP request/body. |
| `closeTimeoutMs` | 1000 | Shutdown grace period; a surviving child receives SIGKILL, followed by one more bounded wait. Also bounds HTTP session termination. |
| `maxToolPages` | 100 | Maximum pages followed by `tools()`. Repeated cursors also fail. |
| `signal` | None | Host cancellation signal, combined with the owning run's cancellation. |
| `fetch` | Native fetch | Optional host transport implementation; must honor AbortSignal. |
| `spawn` | Node spawn | Optional host stdio process factory, primarily for tests. |

Stdio configurations have `command`, optional `args`, optional `cwd`, and optional
`env`. The environment defaults to an empty object: parent secrets, NODE_OPTIONS,
and PATH are not copied implicitly. Use an absolute executable path or explicitly
supply the PATH and variables the child requires. Arguments are passed directly,
without a shell. SDK `cwd` follows Node's spawn rules when omitted.

HTTP configurations have `url` and optional string-record `headers`. Only HTTP
and HTTPS URLs without embedded credentials or fragments are accepted. Redirects
are rejected rather than widening the granted endpoint. Authentication headers
are explicit host configuration; scripts never receive them automatically.

Configuration objects reject unknown fields and accessors. Supplying both
`command` and `url` is invalid. `parseMcpConfig(json, directory)` parses the same
JSON shape, excluding SDK-only `signal`, `fetch`, and `spawn` hooks. It resolves
stdio working directories and executable paths containing a separator relative
to the configuration directory. Bare commands remain PATH lookups.

## CLI and SDK parity

```sh
poe-safe-js --mcp-config ./mcp.json script.ajs
poe-code harness run harness.md --mcp-config ./mcp.json --yes
```

```json
{
  "servers": { "docs": { "url": "https://docs.example/mcp" } },
  "requestTimeoutMs": 30000,
  "closeTimeoutMs": 1000,
  "maxToolPages": 100
}
```

`runCli(argv, { mcp: options })` accepts those options directly. Do not combine
it with `--mcp-config` or a second `mcp` module through `modulesFor`. Core SDK
users register `makeMcpModule(options)` through `modules`. Configuration comes
from the explicit host option/file, never script frontmatter. CLI dry runs do
not start transports.

Both CLIs forward SIGINT to the running harness and await managed transport
cleanup before exiting with status 130. Repeated SIGINT during cleanup does not
skip termination. SIGKILL cannot run cleanup; uncertain external effects still
require reconciliation rather than automatic reissue.

## Methods and ownership

- `tools()` follows pagination and returns `{ name, description?, schema? }`.
- `tool(name, args?)` returns the complete protocol result. An MCP `isError: true`
  result remains a result; JSON-RPC/transport errors reject. JSON-RPC exceptions
  retain their numeric `code` and optional `data` inside SafeJS and during replay.
- `toolBatch(calls)` accepts `{ name, args? }` entries and returns ordered
  `{ ok: true, value }` or `{ ok: false, error }` envelopes, using four workers.
  Host/run cancellation rejects instead of becoming a batch envelope.
- `close()` releases that run's connection. It is idempotent; a later operation
  can reconnect. It cannot close another concurrent run's connection.

Connections are lazy and shared within each run. The same module can serve
concurrent runs without sharing connection ownership. SafeJS awaits cleanup on
success, thrown errors, cancellation, and budget exhaustion. HTTP requests and
bodies are aborted; stdio children receive bounded termination. Cleanup failure
rejects an otherwise successful run, but does not replace an existing failure.
SDK calls outside `run()` require `await client.close()` in a `finally` block.
Those callers can supply `signal` for cancellation.

The legacy `makeMcpModule(connectMcp)` overload remains available for custom
connections and its existing raw-command handles. That callback retains ownership
of its transport and security policy; it is not the managed named-server API.

## Replay and effects

Managed methods have stable host capability identities. Completed replay rebinds
them without connecting or repeating tools. Missing granted capabilities are
rejected before execution. Configuration secrets and transport objects are not
serialized as client state.

Tools and batches declare `read-side-effect` policy. If a process crashes while
their outcome is uncertain, automatic reissue is unsafe: the SDK requires
`hostCallResumeProvider` reconciliation. Completed results replay normally.
`tools()` and connection release are re-issuable. This does not promise exactly
once across uncheckpointed crash windows or migrate an old snapshot.

Snapshots use `jobs-v6`. Registered host methods returned from factories now
retain their original identity. Published 8.0.1 returns false for
`(await get()) === method` when `get` returns the registered `method`; the corrected
runtime returns true. Older markers are rejected before host effects rather than
silently replayed with different identity rules.
