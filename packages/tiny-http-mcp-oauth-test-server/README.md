# tiny-http-mcp-oauth-test-server

`tiny-http-mcp-oauth-test-server` bundles:

- `tiny-http-mcp-server`
- `tiny-oauth-test-server`
- the JWKS-backed verifier from `mcp-oauth`

into one ready-to-run OAuth-protected MCP HTTP fixture.

This package is for tests and local smoke runs only. It is not safe to expose on a public network.

The fixture runs both servers in the same Node process on two HTTP listeners. By default they share the same hostname but use different ports, and the embedded authorization server uses an `/oauth` issuer path. If you pass `issuer`, the embedded authorization server binds to that issuer's host and port.

## Quick Start

### 1. Programmatic direct-token usage with `issueTokenFor`

```ts
import { createMcpOAuthTestServer } from "tiny-http-mcp-oauth-test-server";
import { nodeFetch } from "tiny-http-mcp-server/testing";

const server = createMcpOAuthTestServer({
  autoApprove: true,
  scopes: ["mcp.read"]
});

const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

const token = await handle.oauth.issueTokenFor({
  clientId: "demo-client",
  resource: handle.resource,
  scopes: ["mcp.read"]
});

const initializeResponse = await nodeFetch(handle.mcpUrl, {
  method: "POST",
  headers: {
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "demo-client",
        version: "1.0.0"
      }
    }
  })
});

console.log(handle.mcpUrl);
console.log(handle.prmUrl);
console.log(handle.oauth.issuer);
console.log(handle.resource);
console.log(await initializeResponse.json());

await handle.close();
```

### 2. Programmatic discovery + DCR + PKCE via `tiny-mcp-client`

```ts
import { HttpTransport, McpClient } from "tiny-mcp-client";
import { createMcpOAuthTestServer } from "tiny-http-mcp-oauth-test-server";
import { nodeFetch } from "tiny-http-mcp-server/testing";

const server = createMcpOAuthTestServer({
  autoApprove: true,
  scopes: ["mcp.read"]
});

const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

const client = new McpClient({
  clientInfo: {
    name: "oauth-demo",
    version: "1.0.0"
  }
});

const transport = new HttpTransport({
  url: handle.mcpUrl,
  fetch: nodeFetch,
  oauth: {
    client: {
      mode: "dynamic",
      metadata: {
        clientName: "oauth-demo"
      }
    },
    browser: {
      async openBrowser(authorizationUrl) {
        const response = await fetch(authorizationUrl);
        await response.text();
      }
    }
  }
});

await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map((tool) => tool.name));

const result = await client.callTool({
  name: "echo",
  arguments: {
    text: "hello"
  }
});

console.log(result.content);

await client.close();
await handle.close();
```

### 3. Manual CLI smoke usage with `mcp-inspector` or Claude Code

Start the fixture:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --auto-approve \
  --print-test-token
```

Startup prints:

- `MCP URL`
- `PRM URL`
- `AS issuer`
- `Resource`
- `Test bearer token` when `--print-test-token` is set

For a direct bearer-token smoke run, drop the printed values into a client config like:

```json
{
  "mcpServers": {
    "oauth-fixture": {
      "url": "http://127.0.0.1:43199/mcp",
      "headers": {
        "Authorization": "Bearer <paste-the-printed-test-token>"
      }
    }
  }
}
```

For `mcp-inspector`, use the same `MCP URL` and set the `Authorization` header to `Bearer <paste-the-printed-test-token>`.

For a real OAuth smoke run instead of a pasted bearer token, point the client at the printed `MCP URL` and let it follow the advertised `PRM URL` and `AS issuer`.

## Public API

### `createMcpOAuthTestServer(options?)`

Returns an object with:

- `listen({ port?, hostname? })`

### `listen({ port?, hostname? })`

Starts the bundled fixture and resolves to:

- `url`: the protected MCP endpoint URL
- `mcpUrl`: the protected MCP endpoint URL
- `prmUrl`: the RFC 9728 protected-resource metadata URL
- `resource`: the canonical protected resource URI used as the JWT audience
- `oauth`: the underlying `tiny-oauth-test-server` instance, including `issueTokenFor`
- `close()`: closes both listeners

## Configuration Options

### `createMcpOAuthTestServer(options?)`

| Option          | Default                                        | Description                                                                                                                                                                 |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcpPath`       | `"/mcp"`                                       | Path for the protected MCP endpoint.                                                                                                                                        |
| `issuer`        | generated `http://<hostname>:<port>/oauth` URL | Absolute `http://` issuer URL for the embedded authorization server. Use a non-root path such as `/oauth`. When set, the OAuth listener binds to that issuer host and port. |
| `resource`      | MCP URL                                        | Canonical protected resource URI. This is the audience the JWKS verifier enforces.                                                                                          |
| `ttlSeconds`    | `60`                                           | Access-token TTL in seconds.                                                                                                                                                |
| `autoApprove`   | `false`                                        | Auto-approve the embedded authorization flow.                                                                                                                               |
| `scopes`        | `["mcp.read"]`                                 | Scopes published in PRM and required by the MCP endpoint.                                                                                                                   |
| `staticClients` | `[]`                                           | Preloaded OAuth clients. Each item is `{ clientId, redirectUris, scopes? }`.                                                                                                |

### `listen({ port?, hostname? })`

| Option     | Default     | Description                                                                                                                      |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `port`     | `0`         | Port for the MCP endpoint. When `resource` is omitted, the fixture reserves the final MCP port first so `resource` stays stable. |
| `hostname` | `127.0.0.1` | Hostname/interface for the MCP endpoint. When `issuer` is omitted, the OAuth listener uses the same hostname.                    |

### CLI flags

| Flag                       | Default                                        | Description                                                                                                |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--port <port>`            | `0`                                            | Port for the MCP endpoint.                                                                                 |
| `--hostname <hostname>`    | `127.0.0.1`                                    | Hostname/interface for the MCP endpoint. Also used by the OAuth listener when `--issuer` is omitted.       |
| `--mcp-path <path>`        | `/mcp`                                         | Protected MCP endpoint path.                                                                               |
| `--issuer <url>`           | generated `http://<hostname>:<port>/oauth` URL | Absolute `http://` issuer URL for the embedded authorization server. Use a non-root path such as `/oauth`. |
| `--resource <url>`         | MCP URL                                        | Canonical protected resource URI.                                                                          |
| `--ttl-seconds <seconds>`  | `60`                                           | Access-token TTL in seconds.                                                                               |
| `--auto-approve`           | off                                            | Auto-approve every `/authorize` request.                                                                   |
| `--scopes <scope1,scope2>` | `mcp.read`                                     | Comma-separated scopes to publish and require.                                                             |
| `--print-test-token`       | off                                            | Print a sample bearer token for the configured resource.                                                   |

## Environment Variables

This package does not expose any environment variables.
