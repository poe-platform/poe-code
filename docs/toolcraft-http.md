# Toolcraft Streamable HTTP MCP

`toolcraft/http` exposes the same generated MCP tools as `toolcraft/mcp` through the supported `tiny-http-mcp-server` Streamable HTTP transport.

```ts
import { defineCommand, defineGroup, S } from "toolcraft";
import { runHTTPMCP } from "toolcraft/http";

const commands = defineGroup({
  name: "daybook",
  children: [
    defineCommand({
      name: "get-entry",
      scope: ["mcp"],
      params: S.Object({ entryId: S.String() }),
      handler: async ({ params }) => ({ entryId: params.entryId })
    })
  ]
});

const handle = await runHTTPMCP(commands, {
  name: "daybook",
  version: "1.0.0",
  hostname: "127.0.0.1",
  port: 0,
  path: "/mcp"
});

console.log(handle.url);
await handle.close();
```

`createHTTPMCPServer(commands, options)` returns an unbound server with `listenHttp()`. `runHTTPMCP(commands, options)` binds it and returns `{ url, port, close, closeAllConnections }`. The default binding is `127.0.0.1`, the default path is `/mcp`, and the default port is an operating-system-selected free port.

The options combine Toolcraft MCP runtime options with the upstream HTTP controls: stateful or stateless sessions, JSON responses, allowed hosts and origins, request and batch limits, session limits and expiry, stream limits, concurrent tool-call limits, server timeouts, observability, trusted-proxy handling, custom session stores, and OAuth verification.

## Streaming And Session Mode

Omitting `sessionIdGenerator` uses the transport's default stateful sessions. A custom generator also enables stateful sessions. Explicitly setting `sessionIdGenerator: undefined` selects stateless mode for ordinary request/response tools.

Toolcraft stream commands require session-scoped notifications and therefore work over stateful HTTP or stdio, not stateless HTTP. Both `createHTTPMCPServer()` and `runHTTPMCP()` reject a stateless composition containing exposed MCP stream commands before creating the HTTP transport or starting a producer. The error names the unsupported streams. Setting `enableJsonResponse: false` does not enable subscriptions in stateless mode.

Use stateful HTTP for stream commands, or set the existing `tools` allowlist to expose only ordinary commands on a stateless server. Streams without MCP scope do not affect HTTP startup. Hosted OAuth always selects stateless mode, even if a custom session generator is supplied; expose only ordinary tools through that configuration.

## Request Services

Use `requestServices(context)` to map request-scoped HTTP or OAuth data into the same service interface consumed by command handlers:

```ts
const handle = await runHTTPMCP(commands, {
  name: "daybook",
  version: "1.0.0",
  oauth,
  requestServices: ({ auth }) => ({ requester: auth?.subject ?? "anonymous" })
});
```

The callback runs for each tool invocation. Its context includes the authenticated request, MCP session ID, and verified access-token data. Static `services` are merged first and request services override matching keys for that invocation.

Importing `toolcraft/mcp`, `toolcraft/sdk`, or the main Toolcraft entrypoint does not import the HTTP transport. Applications that need Streamable HTTP should import only `toolcraft/http` and run on Node.js 20 or newer.
