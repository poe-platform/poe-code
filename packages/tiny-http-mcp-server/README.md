# tiny-http-mcp-server

Streamable HTTP transport for tiny MCP servers. It builds on top of `tiny-stdio-mcp-server` and gives you:

- A standalone HTTP server with `listenHttp()`
- An Express middleware adapter
- A low-friction `handleRequest()` API for raw Node.js servers
- Testing helpers for HTTP MCP integration tests

## Install

Node.js 18+ is required.

```sh
npm install tiny-http-mcp-server
```

If you want to mount it in Express:

```sh
npm install tiny-http-mcp-server express
```

If you want to use the testing helpers with the official MCP SDK:

```sh
npm install -D @modelcontextprotocol/sdk
```

## Quick Start: Standalone Server

### Programmatic

```ts
import { createHttpServer, defineSchema } from "tiny-http-mcp-server";

const schema = defineSchema({
  text: { type: "string", description: "Text to reverse" }
});

const server = createHttpServer({
  name: "my-http-server",
  version: "1.0.0"
}).tool("reverse", "Reverse a string", schema, ({ text }) => {
  return text.split("").reverse().join("");
});

const handle = await server.listenHttp({
  port: 3000,
  hostname: "127.0.0.1",
  path: "/mcp"
});

console.log(handle.url);

process.on("SIGINT", () => {
  void handle.close();
});
```

`listenHttp()` starts a Node HTTP server for you and returns a handle with:

- `url`: full MCP endpoint URL
- `port`: resolved TCP port
- `close()`: graceful shutdown for the HTTP listener and transport

By default, programmatic `listenHttp()` uses:

- `port: 0`
- `hostname: "127.0.0.1"`
- `path: "/mcp"`

`path` is normalized for you, so `"mcp"` and `"/mcp"` serve the same endpoint.

### CLI

The package ships a `tiny-http-mcp-server` binary:

```sh
npx tiny-http-mcp-server --port 3000
```

It prints the listening URL to stdout and stays alive until it receives `SIGINT` or `SIGTERM`.

The CLI starts a minimal HTTP MCP server with the package name/version and no custom tools. It is useful for smoke tests, transport debugging, and verifying client behavior.

## Quick Start: Express Middleware Mount

```ts
import express from "express";
import { createExpressMiddleware, createHttpServer, defineSchema } from "tiny-http-mcp-server";

const app = express();

const server = createHttpServer({
  name: "express-mcp-server",
  version: "1.0.0"
}).tool("echo", "Echo text", defineSchema({ text: { type: "string" } }), ({ text }) => text);

app.use(express.json());
app.use("/mcp", createExpressMiddleware(server));

app.listen(3000, "127.0.0.1");
```

`createExpressMiddleware(server)` returns an Express `RequestHandler` that forwards MCP HTTP traffic to `server.handleRequest(req, res)`.

Use this when you want to:

- Reuse an existing Express app
- Put auth middleware in front of the MCP endpoint
- Mount MCP on a custom subpath like `/api/v1/mcp`

## OAuth Protected Resource

To publish RFC 9728 protected-resource metadata and require a Bearer header on MCP requests, pass `oauth` to `createHttpServer()`:

```ts
import {
  createHttpServer,
  createExpressOAuthHandlers,
  TokenVerificationError
} from "tiny-http-mcp-server";

const oauth = {
  resource: "https://example.com/mcp",
  authorizationServers: ["https://auth.example.com"],
  bearerMethodsSupported: ["header"],
  scopesSupported: ["mcp.read", "mcp.write"],
  requiredScopes: ["mcp.read"],
  verifier: {
    async verify(input) {
      throw new TokenVerificationError({
        error: "invalid_token",
        errorDescription: `Implement token verification for ${input.resource}.`
      });
    }
  }
};

const server = createHttpServer({
  name: "oauth-server",
  version: "1.0.0",
  oauth
});

const { metadataMiddleware, mcpMiddleware } = createExpressOAuthHandlers({
  path: "/mcp",
  server,
  oauth
});
```

`oauth` currently supports:

- `resource`: canonical protected resource URI published in the metadata document
- `authorizationServers`: authorization server issuer URLs published as `authorization_servers`
- `requiredScopes`: optional scopes enforced on MCP requests
- `bearerMethodsSupported`: optional values published as `bearer_methods_supported`
- `scopesSupported`: optional values published as `scopes_supported`
- `verifier`: `TokenVerifier` implementation used to validate bearer tokens

When OAuth is enabled, the server exposes `GET /.well-known/oauth-protected-resource` with `application/json`:

```json
{
  "resource": "https://example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp.read", "mcp.write"]
}
```

Unauthenticated requests to the MCP endpoint return `401` with:

```text
WWW-Authenticate: Bearer realm="mcp", resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource"
```

Standalone `listenHttp()` serves both the MCP endpoint and the protected-resource metadata route. For Express, mount `metadataMiddleware` at the app root and mount `mcpMiddleware` on your MCP path.

The package does not define any OAuth-specific environment variables. Configure OAuth with the `oauth` object in code or the CLI flags below.

## BYO HTTP Server: Raw Node.js

If you already own the HTTP server, call `handleRequest()` yourself.

```ts
import http from "node:http";
import { createHttpServer, defineSchema } from "tiny-http-mcp-server";

const server = createHttpServer({
  name: "raw-http-server",
  version: "1.0.0"
}).tool("uppercase", "Uppercase text", defineSchema({ text: { type: "string" } }), ({ text }) =>
  text.toUpperCase()
);

const nodeServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/mcp") {
    res.writeHead(404);
    res.end();
    return;
  }

  await server.handleRequest(req, res);
});

nodeServer.listen(3000, "127.0.0.1");
```

Use this when you need full control over routing, TLS termination, or HTTP server lifecycle.

## Stateless Mode

By default, the transport creates MCP sessions and uses the `Mcp-Session-Id` header for follow-up `POST`, `GET`, and `DELETE` requests.

To disable sessions entirely, set `sessionIdGenerator` to `undefined`:

```ts
const server = createHttpServer({
  name: "stateless-server",
  version: "1.0.0",
  sessionIdGenerator: undefined
});
```

In stateless mode:

- `POST` requests work without `Mcp-Session-Id`
- Responses do not include `Mcp-Session-Id`
- `GET` returns `405`
- `DELETE` returns `405`

CLI equivalent:

```sh
npx tiny-http-mcp-server --stateless
```

## API Reference

The package re-exports the base server helpers from `tiny-stdio-mcp-server`, so you can import `defineSchema`, `createServer`, `Image`, `Audio`, `File`, and related prompt/resource types from here as well. HTTP servers advertise the same prompt and resource capabilities as the stdio server.

### `createHttpServer(options)`

Creates an MCP server with HTTP transport helpers attached.

```ts
import { createHttpServer } from "tiny-http-mcp-server";

const server = createHttpServer({
  name: "my-server",
  version: "1.0.0"
});
```

Returned `HttpServer` instances support:

- `.tool(name, description, schema, handler)` and `.registerTool(definition, handler)` to register tools
- `.prompt(definition, handler)` to register reusable prompts
- `.resource(definition, handler)` and `.resourceTemplate(definition, handler)` to register readable resources
- `.notifyToolsChanged()`, `.notifyPromptsChanged()`, `.notifyResourcesChanged()`, and `.notifyResourceUpdated(uri)` for initialized clients
- `.listenHttp(options?)` to start a standalone Node HTTP server
- `.handleRequest(req, res)` to plug into an existing HTTP stack

#### `createHttpServer(options)` config

`createHttpServer()` accepts the base `ServerOptions` from `tiny-stdio-mcp-server` plus HTTP transport options:

| Option                         | Type                                         | Default                          | Description                                                                                   |
| ------------------------------ | -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `name`                         | `string`                                     | none                             | MCP server name exposed during initialization.                                                |
| `version`                      | `string`                                     | none                             | MCP server version exposed during initialization.                                             |
| `validateToolArguments`        | `boolean`                                    | `true`                           | Validate tool call arguments against each tool input schema.                                  |
| `supportNotifications`         | `boolean`                                    | `true`                           | Advertise tools/prompts/resources list-change notifications.                                  |
| `supportResourceSubscriptions` | `boolean`                                    | `true`                           | Advertise resource subscription support and enable resource update notifications.             |
| `sessionIdGenerator`           | `(() => string) \| undefined`                | built-in visible ASCII generator | Generates new session ids. Pass `undefined` to disable sessions entirely.                     |
| `enableJsonResponse`           | `boolean`                                    | `false`                          | Return `application/json` bodies for `POST` responses instead of `text/event-stream`.         |
| `oauth`                        | `TinyHttpMcpServerOAuthOptions \| undefined` | `undefined`                      | Enables OAuth protected-resource metadata and bearer-token verification for the MCP endpoint. |

### `createExpressMiddleware(server)`

Adapts an `HttpServer` into Express:

```ts
import { createExpressMiddleware } from "tiny-http-mcp-server";

app.use("/mcp", createExpressMiddleware(server));
```

Behavior:

- Returns an Express `RequestHandler`
- Passes request failures to `next(error)`
- Works with normal Express middleware ordering, including auth and `express.json()`

### Types

```ts
import type {
  HttpListenOptions,
  HttpServer,
  HttpServerHandle,
  TinyHttpMcpServerOAuthOptions,
  HttpTransportOptions,
  StreamableHttpTransportOptions
} from "tiny-http-mcp-server";
```

#### `HttpListenOptions`

Options for `server.listenHttp()`:

| Option     | Type          | Default       | Description                                                                                   |
| ---------- | ------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `port`     | `number`      | `0`           | TCP port to bind to. Use `0` for an ephemeral port.                                           |
| `hostname` | `string`      | `"127.0.0.1"` | Interface/host to bind to. IPv4, hostnames, and IPv6 literals are supported.                  |
| `path`     | `string`      | `"/mcp"`      | URL pathname to serve the MCP endpoint on. `mcp` and `/mcp` are normalized to the same value. |
| `signal`   | `AbortSignal` | none          | Aborts the listener and closes the server when triggered.                                     |

#### `HttpServerHandle`

Returned by `listenHttp()`:

| Property | Type                  | Description                                       |
| -------- | --------------------- | ------------------------------------------------- |
| `url`    | `string`              | Full MCP endpoint URL.                            |
| `port`   | `number`              | Resolved TCP port.                                |
| `close`  | `() => Promise<void>` | Gracefully shuts down the listener and transport. |

#### `HttpTransportOptions` / `StreamableHttpTransportOptions`

These are the same shape:

| Option               | Type                                         | Default            | Description                                                                               |
| -------------------- | -------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `sessionIdGenerator` | `(() => string) \| undefined`                | built-in generator | Controls session support and session id creation.                                         |
| `enableJsonResponse` | `boolean`                                    | `false`            | Switches `POST` responses from SSE framing to plain JSON responses.                       |
| `oauth`              | `TinyHttpMcpServerOAuthOptions \| undefined` | `undefined`        | Publishes RFC 9728 metadata and protects the MCP endpoint with bearer-token verification. |

#### `HttpServer`

`HttpServer` extends the base tiny stdio server with HTTP methods:

```ts
interface HttpServer {
  tool<T>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: ToolHandler<T>
  ): HttpServer;
  listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
```

## CLI Usage

```sh
tiny-http-mcp-server [options]
```

### Flags

| Flag                                         | Default     | Description                                                                                                                          |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--port <port>`                              | `3000`      | Port to listen on. Use `0` for an ephemeral port.                                                                                    |
| `--hostname <hostname>`                      | `127.0.0.1` | Hostname/interface to bind to. IPv4, hostnames, and IPv6 literals such as `::1` are supported.                                       |
| `--path <path>`                              | `/mcp`      | MCP endpoint path. `api/mcp` and `/api/mcp` are equivalent.                                                                          |
| `--stateless`                                | off         | Disable session support.                                                                                                             |
| `--json-response`                            | off         | Return `application/json` for `POST` responses.                                                                                      |
| `--oauth-resource <uri>`                     | none        | Enable OAuth mode with this canonical protected resource URI. Requires `--oauth-authorization-server` and `--oauth-verifier-module`. |
| `--oauth-authorization-server <issuer>`      | none        | Authorization server issuer URL to publish in metadata. Repeat the flag for multiple issuers.                                        |
| `--oauth-supported-scope <scope>`            | none        | Scope to publish in `scopes_supported`. Repeat the flag for multiple scopes.                                                         |
| `--oauth-required-scope <scope>`             | none        | Scope required on incoming MCP requests. Repeat the flag for multiple scopes.                                                        |
| `--oauth-bearer-method <method>`             | none        | Bearer transport to publish in `bearer_methods_supported`. Repeat the flag for multiple methods.                                     |
| `--oauth-verifier-module <path-or-file-url>` | none        | Module path, `file:` URL, or package specifier that exports the `TokenVerifier` used in CLI mode.                                    |
| `--oauth-verifier-export <name>`             | `default`   | Named export to load from `--oauth-verifier-module`.                                                                                 |
| `-h`, `--help`                               | off         | Print help and exit.                                                                                                                 |

Examples:

```sh
tiny-http-mcp-server --port 8080 --path /api/mcp
tiny-http-mcp-server --port 0 --stateless --json-response
tiny-http-mcp-server \
  --oauth-resource https://example.com/mcp \
  --oauth-authorization-server https://auth.example.com \
  --oauth-supported-scope mcp.read \
  --oauth-required-scope mcp.read \
  --oauth-verifier-module ./verify-token.mjs
```

## Testing Helpers

Testing helpers are exported from the package subpath:

```ts
import {
  createHttpTestPair,
  createHttpTestPairWithTinyClient,
  createTestMcpServer
} from "tiny-http-mcp-server/testing";
```

### `createHttpTestPair(server)`

Starts an `HttpServer`, connects an official MCP SDK client to it, and returns:

- `client`: `@modelcontextprotocol/sdk` client
- `transport`: SDK streamable HTTP client transport
- `handle`: `HttpServerHandle`
- `url`: endpoint URL
- `cleanup()`: closes client and server

Example:

```ts
import { expect, test } from "vitest";
import { createHttpTestPair, createTestMcpServer } from "tiny-http-mcp-server/testing";

test("calls a tool over HTTP", async () => {
  const pair = await createHttpTestPair(createTestMcpServer());

  try {
    const result = await pair.client.callTool({
      name: "echo",
      arguments: { text: "hello" }
    });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
  } finally {
    await pair.cleanup();
  }
});
```

### `createTestMcpServer(options?)`

Creates a ready-made `HttpServer` for integration and conformance tests. It includes tools such as:

- `echo`, `reverse`, `uppercase` — text transformations
- `get_user`, `get_list` — structured data
- `get_image`, `get_audio`, `get_file`, `get_mixed` — binary/resource content blocks
- `throw_sync`, `throw_async` — error handling scenarios
- `empty_result`, `slow`, `large_output` — edge-case coverage
- prompt/resource fixtures for `prompts/list`, `prompts/get`, `resources/list`, `resources/read`, resource templates, subscriptions, and list/update notifications

Supported options:

| Option               | Type                          | Default                                |
| -------------------- | ----------------------------- | -------------------------------------- |
| `name`               | `string`                      | `"conformance-test-server"`            |
| `version`            | `string`                      | `"1.0.0"`                              |
| `enableJsonResponse` | `boolean`                     | inherited default (`false`)            |
| `sessionIdGenerator` | `(() => string) \| undefined` | inherited default (built-in generator) |

Example:

```ts
const server = createTestMcpServer({
  enableJsonResponse: true,
  sessionIdGenerator: undefined
});
```

### `createHttpTestPairWithTinyClient(server)`

Like `createHttpTestPair`, but connects a [`tiny-mcp-client`](https://www.npmjs.com/package/tiny-mcp-client) transport instead of the official SDK. Returns `null` when `tiny-mcp-client` is not installed.

The returned `TinyHttpTestPair` includes a `requests` array that logs every HTTP request the client makes — useful for asserting transport-level behavior (session headers, `DELETE` teardown, SSE vs JSON responses).

```ts
import { expect, test } from "vitest";
import {
  createHttpTestPairWithTinyClient,
  createTestMcpServer
} from "tiny-http-mcp-server/testing";

test("tiny-mcp-client sends DELETE on close", async () => {
  const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());
  if (pair === null) return; // tiny-mcp-client not installed

  try {
    await pair.client.callTool({ name: "echo", arguments: { text: "hi" } });
    await pair.client.close();

    expect(pair.requests.some((r) => r.method === "DELETE")).toBe(true);
  } finally {
    await pair.cleanup();
  }
});
```

## Environment Variables

This package does not use any environment variables.

All runtime configuration is passed through function options or CLI flags.

## License

MIT
