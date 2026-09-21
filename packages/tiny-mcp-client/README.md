# tiny-mcp-client

`tiny-mcp-client` is a lightweight Model Context Protocol client used by tests, fixtures, and package integrations. It supports stdio transports, Streamable HTTP and legacy HTTP/SSE transports, in-memory test pairs, JSON-RPC helpers, and OAuth metadata discovery for OAuth-protected MCP HTTP servers.

## Usage

```ts
import { HttpTransport, McpClient } from "tiny-mcp-client";

const client = new McpClient({
  clientInfo: { name: "demo", version: "0.1.0" }
});

await client.connect(new HttpTransport({ url: "http://127.0.0.1:3000/mcp" }));
const tools = await client.listTools();
console.log(tools);
const result = await client.callTool({
  name: "search",
  arguments: { query: "typed outputs" }
});
console.log(result.structuredContent);
await client.close();
```

Omit `protocolVersion` for automatic modern discovery and legacy negotiation.
Set it to `"2025-03-26"`, `"2025-06-18"`, `"2025-11-25"` or `"2026-07-28"`
to pin a protocol. `McpProtocolVersion` and the immutable
`MCP_PROTOCOL_VERSIONS` list expose these supported revisions. A modern pin
rejects failed or timed-out discovery without sending legacy initialization.
Legacy pins skip modern discovery and require the selected revision to match.
Automatic legacy negotiation still offers `2025-03-26` and accepts any supported
legacy revision selected by the server. Subsequent HTTP POST, GET and DELETE
requests use that selected revision, including endpoints without session IDs.
Unsupported pins fail before connection setup.

`Tool` includes MCP `outputSchema` when a server advertises typed tool output.
`CallToolResult.structuredContent` preserves modern JSON values; legacy servers
require an object. Complete `content[]` blocks remain available in either case.

Set `requestTimeoutMs` on `McpClient` or `timeoutMs` on individual requests.
Numeric deadlines must be finite, nonnegative and no greater than
2,147,483,647 ms; oversized values fail before a request is sent. Individual
JSON-RPC requests also accept `timeoutMs: null` to disable their timer.
The deadline covers the complete request, including modern input callbacks and
continuation rounds. On expiry, callback signals abort and late input cannot
submit another round. Successful requests, cancellation and disposal clear the
timer; a timeout releases request capacity so later operations can proceed.

## Transports

| Transport                       | Description                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `StdioTransport`                | Spawns an MCP server process and communicates over stdio.                                                   |
| `HttpTransport`                 | Connects to Streamable HTTP endpoints, or legacy HTTP/SSE with `mode: "sse"`. |
| `createInMemoryTransportPair()` | Creates paired streams for in-process tests.                                                                |

Legacy SSE mode opens a GET stream and posts messages to the endpoint announced
by the server. Announced endpoints must remain on the original origin without
embedded credentials or fragments; endpoint changes close the connection.
Both transports accept the same headers, OAuth provider and response limits.
Static HTTP headers are copied and validated when the transport is constructed,
before OAuth callbacks run. Invalid headers fail without reflecting their values.
Use `snapshotHttpTransportHeaders(headers)` to apply the same ownership and safe
validation when preparing a registry before constructing transports.
`maxResponseBytes` bounds a complete JSON body or each SSE event (default 16 MiB).
Receive streams may carry many bounded events and keepalive comments; the limit
does not cap their lifetime bytes. Use request deadlines and cancellation to
bound pending operations.
Receive reconnections retain the last completed event ID through events and
keepalives without IDs. An explicit empty `id:` clears the resume header,
including any initially configured value.
Unicode event IDs use UTF-8 bytes in `Last-Event-ID` headers.
HTTP failures expose `HttpTransportError.status` and `.method`, so callers can
make transport decisions without parsing error messages. Legacy HTTP/SSE
`connect()` also waits for the initialized notification POST to complete before
reporting ready. Completion failures reject the connection and expose
`rpcMethod: "notifications/initialized"`; they are not setup transport mismatches.

`HttpTransport.closeReason` resolves with the original failure as disposal begins.
Client requests retain that reason even if session deletion is slow or fails.
Await `transport.closed` to finish cleanup; its reason reports a deletion failure
when cleanup fails, otherwise the original reason. Custom transports can expose
the same optional `closeReason` promise when closing requires asynchronous work.

## OAuth HTTP support

`HttpTransport` accepts `oauth` options from `mcp-oauth`. When a protected server returns a Bearer `WWW-Authenticate` challenge, the transport discovers protected-resource metadata, loads authorization-server metadata, lets the OAuth provider handle authorization, and retries the request when credentials are available.

```ts
import { HttpTransport } from "tiny-mcp-client";

const transport = new HttpTransport({
  url: "https://mcp.example.com/mcp",
  oauth: {
    client: {
      mode: "dynamic",
      metadata: {
        clientName: "tiny-client"
      }
    },
    browser: {
      openBrowser: async (url) => {
        console.log(`Open ${url}`);
      }
    }
  }
});
```

You can also call `discoverOAuthMetadata(resourceUrl, options)` directly, or instantiate `OAuthMetadataDiscovery` with a custom `fetch` implementation and shared cache. An explicit `resourceMetadataUrl` requires fresh network discovery without reading either cache; validated results still populate both caches. Lookup options accept `signal`; cancellation stops metadata fetches and body reads without trying another discovery candidate. It also settles while shared-cache reads, writes or eviction wait. Host cache work may finish afterward; its late rejection remains observed, and canceled discovery does not start another candidate.
Resource/issuer binding mismatches and exhausted authorization-server discovery
expose `OAuthMetadataError.phase` while retaining complete SDK messages.
Protected-resource metadata HTTP failures also expose their numeric `status`.
Rejected metadata bodies start cleanup without delaying failure or caller
cancellation. Host cleanup may finish later; its rejection remains observed.
`OAuthMetadataError.is(value)` recognizes separately bundled native copies.

OAuth provider inputs receive the originating request's `signal`, covering header authorization and unauthorized handling. Modern request cancellation stops its OAuth work while leaving other requests usable; transport disposal cancels all pending OAuth operations. The default provider propagates this signal to callback, registration and token work. Custom providers must observe it for their own operations.

## Testing helpers

- `createTestPair()` and `createSdkTestPair()` create paired client/server fixtures.
- `createInMemoryTransportPair()` is useful for fast unit tests without opening sockets or spawning processes.
- JSON-RPC error constants are exported for assertions: `ERROR_PARSE`, `ERROR_INVALID_REQUEST`, `ERROR_METHOD_NOT_FOUND`, `ERROR_INVALID_PARAMS`, and `ERROR_INTERNAL`.

## Configuration Options

### `McpClientOptions`

| Option                                                     | Type                                | Description                                      |
| ---------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `clientInfo`                                               | `{ name: string; version: string }` | Required client identity sent during initialize. |
| `capabilities`                                             | `ClientCapabilities`                | Optional MCP client capabilities.                |
| `onToolsChanged`, `onResourcesChanged`, `onPromptsChanged` | callbacks                           | Optional notification handlers.                  |
| `onResourceUpdated`, `onLog`, `onProgress`                 | callbacks                           | Optional resource/log/progress handlers.         |
| `onSamplingRequest`, `onRootsList`                         | callbacks                           | Optional server-to-client request handlers.      |

### `HttpTransportOptions`

| Option                | Type                                  | Description                           |
| --------------------- | ------------------------------------- | ------------------------------------- |
| `url`                 | `string`                              | MCP HTTP endpoint URL.                |
| `headers`             | `HeadersInit`                         | Static headers added to requests.     |
| `fetch`               | `(input, init?) => Promise<Response>` | Custom fetch implementation.          |
| `oauth`               | `OAuthClientProviderOptions`          | Enables OAuth authorization handling. |
| `oauthDiscoveryCache` | `OAuthDiscoveryCache`                 | Optional shared metadata cache.       |
| `maxResponseBytes`     | `number`                              | Maximum JSON/error body or retained SSE event bytes; defaults to 16 MiB and must be a positive safe integer. |

### `StdioTransportOptions`

| Option    | Type                | Description                      |
| --------- | ------------------- | -------------------------------- |
| `command` | `string`            | Server executable.               |
| `args`    | `string[]`          | Server args.                     |
| `cwd`     | `string`            | Server working directory.        |
| `env`     | `NodeJS.ProcessEnv` | Server environment.              |
| `spawn`   | `StdioSpawn`        | Custom spawn function for tests. |

## Environment Variables

This package does not expose public environment variables. Pass process environment explicitly through `StdioTransportOptions.env` when a spawned MCP server needs it.
