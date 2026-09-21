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

`Tool` includes MCP `outputSchema` when a server advertises typed tool output. `CallToolResult` includes `structuredContent?: Record<string, unknown>` for typed results; legacy/content-block tools still use `content[]`.

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

## OAuth HTTP support

`HttpTransport` accepts `oauth` options from `mcp-oauth`. When a protected server returns a Bearer `WWW-Authenticate` challenge, the transport discovers protected-resource metadata, loads authorization-server metadata, lets the OAuth provider handle authorization, and retries the request when credentials are available.

```ts
import { HttpTransport, createDefaultOAuthClientProvider } from "tiny-mcp-client";

const transport = new HttpTransport({
  url: "https://mcp.example.com/mcp",
  oauth: {
    provider: createDefaultOAuthClientProvider({
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
    })
  }
});
```

You can also call `discoverOAuthMetadata(resourceUrl, options)` directly, or instantiate `OAuthMetadataDiscovery` with a custom `fetch` implementation and shared cache.

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
