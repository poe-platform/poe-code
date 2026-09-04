# tiny-http-mcp-server

Streamable HTTP transport for tiny MCP servers. It builds on top of `tiny-stdio-mcp-server` and gives you:

- A standalone HTTP server with `listenHttp()`
- An Express middleware adapter
- A `handleRequest()` API for raw Node.js servers
- Testing helpers for HTTP MCP integration tests

## Install

Node.js 20+ is required.

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

`listenHttp()` starts a Node HTTP server and returns a handle with:

- `url`: full MCP endpoint URL
- `port`: resolved TCP port
- `close()`: graceful shutdown for the HTTP listener and transport
- `closeAllConnections()`: force-close remaining HTTP connections after a shutdown grace period

By default, programmatic `listenHttp()` uses:

- `port: 0`
- `hostname: "127.0.0.1"`
- `path: "/mcp"`

`path` is normalized, so `"mcp"` and `"/mcp"` serve the same endpoint.

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

app.use("/mcp", createExpressMiddleware(server));

app.listen(3000, "127.0.0.1");
```

`createExpressMiddleware(server)` returns an Express `RequestHandler` that forwards MCP HTTP traffic to `server.handleRequest(req, res)`.

Do not mount `express.json()` or another body parser before the MCP middleware. The transport reads the raw request stream so it can enforce `maxRequestBytes` and return JSON-RPC parse error `-32700`. Any body parser mounted first takes over request-size limits and parse-error semantics; for example, Express defaults to a 100 KB JSON limit and returns its own HTML errors.

Use this when you want to:

- Reuse an existing Express app
- Put auth middleware in front of the MCP endpoint
- Mount MCP on a custom subpath like `/api/v1/mcp`

## OAuth Protected Resource

To publish RFC 9728 protected-resource metadata and require a Bearer header on MCP requests, pass `oauth` to `createHttpServer()`:

```ts
import express from "express";
import {
  createHttpServer,
  createExpressOAuthHandlers,
  createJwksTokenVerifier
} from "tiny-http-mcp-server";

const app = express();

const oauth = {
  resource: "https://example.com/mcp",
  authorizationServers: ["https://auth.example.com"],
  bearerMethodsSupported: ["header"],
  scopesSupported: ["mcp.read", "mcp.write"],
  requiredScopes: ["mcp.read"],
  verifier: createJwksTokenVerifier({
    jwksUrl: "https://auth.example.com/.well-known/jwks.json",
    requireAccessTokenType: true
  })
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

app.use(metadataMiddleware);
app.use("/mcp", mcpMiddleware);

app.listen(3000, "127.0.0.1");
```

`oauth` currently supports:

- `resource`: canonical protected resource URI published in the metadata document
- `authorizationServers`: authorization server issuer URLs published as `authorization_servers`
- `requiredScopes`: optional scopes enforced on MCP requests
- `bearerMethodsSupported`: optional values published as `bearer_methods_supported`
- `scopesSupported`: optional values published as `scopes_supported`
- `verifier`: `TokenVerifier` implementation used to validate bearer tokens

For JWT bearer tokens signed by an authorization server JWKS endpoint, use the exported `createJwksTokenVerifier()` helper:

```ts
const verifier = createJwksTokenVerifier({
  jwksUrl: "https://auth.example.com/.well-known/jwks.json",
  jwksFetchTimeoutMs: 5000,
  jwksRefreshCooldownMs: 30000,
  requireAccessTokenType: true
});
```

`createJwksTokenVerifier(options)` accepts:

| Option                   | Type                | Default        | Description                                                                              |
| ------------------------ | ------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `jwksUrl`                | `string \| URL`     | none           | Authorization server JWKS endpoint.                                                      |
| `clockSkewSeconds`       | `number`            | `30`           | Allowed JWT time-claim clock skew.                                                       |
| `allowedAlgorithms`      | `readonly string[]` | asymmetric set | Allowed JWT signature algorithms.                                                        |
| `jwksCacheTtlMs`         | `number`            | `300000`       | Successful JWKS cache lifetime.                                                          |
| `jwksFetchTimeoutMs`     | `number`            | `5000`         | Timeout for each JWKS HTTP fetch.                                                        |
| `jwksRefreshCooldownMs`  | `number`            | `30000`        | Minimum interval between forced refreshes after an unknown key id.                       |
| `allowInsecureJwks`      | `boolean`           | `false`        | Permit non-HTTPS JWKS URLs. Loopback HTTP URLs are allowed without enabling this option. |
| `requireAccessTokenType` | `boolean`           | `false`        | Require the JWT `typ` protected header to be `at+jwt`.                                   |
| `fetch`                  | `typeof fetch`      | global `fetch` | Custom fetch implementation.                                                             |

For opaque access tokens, implement `TokenVerifier` with RFC 7662 token introspection:

```ts
import { TokenVerificationError, type TokenVerifier } from "tiny-http-mcp-server";

const verifier: TokenVerifier = {
  async verify({ token, resource, authorizationServers, requiredScopes }) {
    const response = await fetch("https://auth.example.com/oauth2/introspect", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" })
    });
    if (!response.ok) {
      throw Object.assign(new Error("introspection unavailable"), {
        error: "temporarily_unavailable"
      });
    }

    const claims = (await response.json()) as Record<string, unknown>;
    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
    const audience =
      typeof claims.aud === "string"
        ? [claims.aud]
        : Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")
          ? claims.aud
          : [];
    const issuer = typeof claims.iss === "string" ? claims.iss : "";
    const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;
    if (
      claims.active !== true ||
      !authorizationServers.includes(issuer) ||
      !audience.includes(resource) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new TokenVerificationError({ error: "invalid_token" });
    }
    if (!requiredScopes.every((scope) => scopes.includes(scope))) {
      throw new TokenVerificationError({ error: "insufficient_scope", scope: requiredScopes });
    }

    return {
      token,
      issuer,
      audience,
      scopes,
      expiresAt,
      claims,
      ...(typeof claims.sub === "string" ? { subject: claims.sub } : {}),
      ...(typeof claims.client_id === "string" ? { clientId: claims.client_id } : {})
    };
  }
};
```

Keep introspection credentials server-side, authenticate the introspection request using the method required by your authorization server, and validate any additional issuer, audience, token-type, or expiry rules your deployment requires.

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

Standalone `listenHttp()` serves both the MCP endpoint and the protected-resource metadata route. For Express, mount `metadataMiddleware` at the app root and mount `mcpMiddleware` on your MCP path, as shown above. Do not put a body parser before `mcpMiddleware`.

OAuth sessions are bound to the verified token `subject`, falling back to `clientId` when the subject is absent. This auth-subject binding prevents a different identity from reusing the session id: mismatched requests receive `404`, just like an unknown session. Tokens with neither a non-empty subject nor client id create unbound sessions.

For non-HTTP integrations, `createProtectedResourceMetadataDocument(oauth)` returns the metadata JSON document without creating middleware.

`createExpressOAuthHandlers()` also accepts:

- `trustedProxy`: trust `X-Forwarded-Proto` and `X-Forwarded-Host` when building metadata challenge URLs.
- `observability`: emit auth failure events through the same observability hook shape used by the HTTP transport.

The package does not define any OAuth-specific environment variables. Configure OAuth with the `oauth` object in code or the CLI flags below.

## Production Deployment

Prefer the standalone `listenHttp()` server behind a TLS-terminating reverse proxy such as nginx or an AWS Application Load Balancer. Reserve the Express adapter for embedding MCP into an existing Express application; it adds middleware-ordering concerns without replacing the transport's production controls.

Production checklist:

- Set `allowedHosts` to the public MCP hostname, such as `mcp.example.com`. The loopback-only default intentionally returns `403` for public hostnames.
- When TLS terminates at the proxy, set `trustedProxy: true` and have the proxy replace `X-Forwarded-Proto` and `X-Forwarded-Host`. Only trust these headers when requests can reach the server exclusively through that proxy.
- Set `allowedOrigins` only when browser-based clients need CORS. Non-browser MCP clients do not require it.
- Apply explicit limits for the workload: `maxRequestBytes` around 1-4 MiB, `maxBatchSize` around `16`, plus bounded `maxSessions`, `sessionTtlMs` around 15 minutes, `maxConcurrentToolCalls`, and `toolCallTimeoutMs`.
- Configure `requestTimeoutMs`, `headersTimeoutMs`, and `keepAliveTimeoutMs` deliberately. Keep Node timeouts that can end proxied work above the proxy idle timeout so the proxy owns idle connection cleanup.
- Keep `maxStreamsPerSession` at its default of `1` unless clients genuinely need parallel GET SSE streams. Bound slow consumers with `maxStreamBufferBytes` and the replay window with `maxSseEventHistory`.
- Configure graceful shutdown. The CLI defaults `--shutdown-grace-ms` to 10 seconds. Programmatic deployments should start `handle.close()`, then call `handle.closeAllConnections()` only if their own grace deadline expires first.
- Use OAuth with `createJwksTokenVerifier()` for JWT access tokens, or a custom `TokenVerifier` for opaque tokens. Leave `allowInsecureJwks` disabled outside local development and consider `requireAccessTokenType: true` when the issuer emits RFC 9068 access-token JWTs.
- Put request-rate and connection-rate limits at the reverse proxy, before requests consume Node streams, sessions, or tool-call capacity.

For nginx, disable response buffering for SSE, use HTTP/1.1 to the upstream, and keep `proxy_read_timeout` greater than `sseKeepAliveMs`:

```nginx
location /mcp {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_read_timeout 75s; # greater than the default 30s sseKeepAliveMs
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Wire `observability.onEvent` to structured logs or metrics. This console recipe can be replaced directly with `logger.info(event, "mcp.http")` for pino:

```ts
const server = createHttpServer({
  name: "production-server",
  version: "1.0.0",
  observability: {
    onEvent(event) {
      console.info(JSON.stringify({ component: "mcp.http", ...event }));
    }
  }
});
```

### Multiple Instances and Sticky Routing

A custom `sessionStore` can preserve the session record so an instance can reconstruct session lifecycle state, including the `authSubject` used to bind an OAuth session to its verified identity. It does not make the HTTP transport distributed: active SSE streams and `Last-Event-ID` replay history remain in memory on the instance that created them.

Horizontal scaling therefore requires sticky routing by `Mcp-Session-Id` so every request for a session reaches the same instance. Restarting or rerouting an instance loses its live streams and replay history even when the session record survives. `maxSseEventHistory` bounds how many instance-local events can be replayed; it is not a shared event log.

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

The package re-exports the base server helpers from `tiny-stdio-mcp-server`, so you can import `defineSchema`, `createServer`, `Image`, `Audio`, `File`, and related types from here as well.

HTTP tools have the same typed-output behavior as stdio tools. Pass an optional root-object `outputSchema` to `.tool(...)` to advertise MCP `Tool.outputSchema`, validate handler results, return `CallToolResult.structuredContent`, and keep a JSON text backstop in `content[]` for older clients. Omit `outputSchema` for prose, image, audio, file, and other content-block tools.

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

- `.tool(name, description, schema, handler, outputSchema?)` to register tools
- `.registerTool(definition, handler)` to register tools with full MCP metadata
- `.listenHttp(options?)` to start a standalone Node HTTP server
- `.handleRequest(req, res)` to plug into an existing HTTP stack

#### `createHttpServer(options)` config

`createHttpServer()` accepts the base `ServerOptions` from `tiny-stdio-mcp-server` plus HTTP transport options:

| Option                   | Type                                         | Default                          | Description                                                                                   |
| ------------------------ | -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `name`                   | `string`                                     | none                             | MCP server name exposed during initialization.                                                |
| `version`                | `string`                                     | none                             | MCP server version exposed during initialization.                                             |
| `toolCallTimeoutMs`      | `number`                                     | unlimited                        | Positive integer timeout in milliseconds. Returns `-32603` without cancelling the handler.    |
| `sessionIdGenerator`     | `(() => string) \| undefined`                | built-in visible ASCII generator | Generates new session ids. Pass `undefined` to disable sessions entirely.                     |
| `enableJsonResponse`     | `boolean`                                    | `false`                          | Return `application/json` bodies for `POST` responses instead of `text/event-stream`.         |
| `allowedHosts`           | `readonly string[]`                          | loopback hosts                   | Allowed `Host` header values for DNS rebinding protection.                                    |
| `allowedOrigins`         | `readonly string[]`                          | `[]`                             | Allowed CORS `Origin` values. Empty means no cross-origin browser clients are allowed.        |
| `maxRequestBytes`        | `number`                                     | unlimited                        | Maximum JSON request body size.                                                               |
| `maxBatchSize`           | `number`                                     | unlimited                        | Maximum JSON-RPC batch member count.                                                          |
| `maxSessions`            | `number`                                     | `128`                            | Maximum active sessions.                                                                      |
| `sessionTtlMs`           | `number`                                     | `900000`                         | Expire idle sessions after this duration.                                                     |
| `maxStreamsPerSession`   | `number`                                     | `1`                              | Maximum concurrent GET SSE streams per session.                                               |
| `maxStreamBufferBytes`   | `number`                                     | `1048576`                        | End a GET SSE stream before a live write when its buffered bytes exceed this limit.           |
| `maxSseEventHistory`     | `number`                                     | `100`                            | Number of server-sent events retained for `Last-Event-ID` replay.                             |
| `sseKeepAliveMs`         | `number`                                     | `30000`                          | GET SSE keepalive interval in milliseconds. Set to `0` to disable keepalive comments.         |
| `maxConcurrentToolCalls` | `number`                                     | `4`                              | Maximum concurrent tool calls across sessions.                                                |
| `sessionStore`           | `SessionStore`                               | in-memory store                  | Pluggable session-record storage; SSE streams and replay history remain instance-local.       |
| `requestIdGenerator`     | `() => string`                               | incrementing ids                 | Generates request ids when `X-Request-Id` is absent.                                          |
| `observability`          | `HttpObservabilityOptions`                   | none                             | Emits request, auth, session, stream, and tool lifecycle events.                              |
| `trustedProxy`           | `boolean`                                    | `false`                          | Trust `X-Forwarded-Proto` and `X-Forwarded-Host` for metadata challenge URLs.                 |
| `oauth`                  | `TinyHttpMcpServerOAuthOptions \| undefined` | `undefined`                      | Enables OAuth protected-resource metadata and bearer-token verification for the MCP endpoint. |

### `registerTool(definition, handler)`

Registers a tool using the complete MCP tool definition. Use it instead of `.tool(...)` when you need fields such as `title`, `annotations`, `execution`, `icons`, or `_meta`.

```ts
server.registerTool(
  {
    name: "lookup",
    title: "Lookup",
    description: "Look up a record",
    inputSchema: defineSchema({ id: { type: "string" } }),
    annotations: { readOnlyHint: true }
  },
  async ({ id }, context) => {
    return `Lookup ${id} for session ${context.sessionId ?? "stateless"}`;
  }
);
```

The handler receives the same `HttpToolContext` as `.tool(...)`. The optional `outputSchema` in the definition enables typed structured-output validation.

### `createExpressMiddleware(server)`

Adapts an `HttpServer` into Express:

```ts
import { createExpressMiddleware } from "tiny-http-mcp-server";

app.use("/mcp", createExpressMiddleware(server));
```

Behavior:

- Returns an Express `RequestHandler`
- Passes request failures to `next(error)`
- Works with normal Express middleware ordering, including authentication middleware
- Must be mounted before any body parser that would consume the MCP request stream

### Types

```ts
import type {
  HttpListenOptions,
  HttpServer,
  HttpServerHandle,
  TinyHttpMcpServerOAuthOptions,
  HttpObservabilityOptions,
  HttpTransportOptions,
  Session,
  SessionStore,
  StreamableHttpTransportOptions
} from "tiny-http-mcp-server";
```

#### `HttpListenOptions`

Options for `server.listenHttp()`:

| Option               | Type          | Default       | Description                                                                                   |
| -------------------- | ------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `port`               | `number`      | `0`           | TCP port to bind to. Use `0` for an ephemeral port.                                           |
| `hostname`           | `string`      | `"127.0.0.1"` | Interface/host to bind to. IPv4, hostnames, and IPv6 literals are supported.                  |
| `path`               | `string`      | `"/mcp"`      | URL pathname to serve the MCP endpoint on. `mcp` and `/mcp` are normalized to the same value. |
| `signal`             | `AbortSignal` | none          | Aborts the listener and closes the server when triggered.                                     |
| `requestTimeoutMs`   | `number`      | Node default  | Sets `http.Server.requestTimeout`.                                                            |
| `headersTimeoutMs`   | `number`      | Node default  | Sets `http.Server.headersTimeout`.                                                            |
| `keepAliveTimeoutMs` | `number`      | Node default  | Sets `http.Server.keepAliveTimeout`.                                                          |

#### `HttpServerHandle`

Returned by `listenHttp()`:

| Property              | Type                  | Description                                                                               |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `url`                 | `string`              | Full MCP endpoint URL.                                                                    |
| `port`                | `number`              | Resolved TCP port.                                                                        |
| `close`               | `() => Promise<void>` | Gracefully shuts down the listener and transport.                                         |
| `closeAllConnections` | `() => void`          | Force-closes all remaining HTTP connections. Use only after a graceful shutdown deadline. |

#### `HttpTransportOptions` / `StreamableHttpTransportOptions`

`HttpTransportOptions` combines the base `ServerOptions` with `StreamableHttpTransportOptions` and the optional OAuth config. The table notes options that are not part of the lower-level transport type.

| Option                   | Type                                         | Default            | Description                                                                               |
| ------------------------ | -------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `toolCallTimeoutMs`      | `number`                                     | unlimited          | `HttpTransportOptions` only. Returns `-32603` on timeout without cancelling the handler.  |
| `sessionIdGenerator`     | `(() => string) \| undefined`                | built-in generator | Controls session support and session id creation.                                         |
| `enableJsonResponse`     | `boolean`                                    | `false`            | Switches `POST` responses from SSE framing to plain JSON responses.                       |
| `allowedHosts`           | `readonly string[]`                          | loopback hosts     | Allowed `Host` header values.                                                             |
| `allowedOrigins`         | `readonly string[]`                          | `[]`               | Allowed CORS origins.                                                                     |
| `maxRequestBytes`        | `number`                                     | unlimited          | Maximum JSON request body size.                                                           |
| `maxBatchSize`           | `number`                                     | unlimited          | Maximum JSON-RPC batch member count.                                                      |
| `maxSessions`            | `number`                                     | `128`              | Maximum active sessions.                                                                  |
| `sessionTtlMs`           | `number`                                     | `900000`           | Idle session expiration window.                                                           |
| `maxStreamsPerSession`   | `number`                                     | `1`                | Maximum concurrent GET SSE streams per session.                                           |
| `maxStreamBufferBytes`   | `number`                                     | `1048576`          | End a GET SSE stream before a live write when its buffered bytes exceed this limit.       |
| `maxSseEventHistory`     | `number`                                     | `100`              | Number of SSE events retained for replay.                                                 |
| `sseKeepAliveMs`         | `number`                                     | `30000`            | GET SSE keepalive interval in milliseconds. Set to `0` to disable keepalive comments.     |
| `maxConcurrentToolCalls` | `number`                                     | unlimited          | Maximum concurrent tool calls across sessions.                                            |
| `sessionStore`           | `SessionStore`                               | in-memory store    | Pluggable session-record storage; SSE and replay state remain local to each instance.     |
| `requestIdGenerator`     | `() => string`                               | incrementing ids   | Request id generator used when the request lacks `X-Request-Id`.                          |
| `observability`          | `HttpObservabilityOptions`                   | none               | Event hook for request, auth, session, stream, and tool lifecycle telemetry.              |
| `trustedProxy`           | `boolean`                                    | `false`            | Trust forwarded host/proto headers for metadata challenge URLs.                           |
| `oauth`                  | `TinyHttpMcpServerOAuthOptions \| undefined` | `undefined`        | Publishes RFC 9728 metadata and protects the MCP endpoint with bearer-token verification. |

#### `HttpServer`

`HttpServer` extends the base tiny stdio server with HTTP methods:

```ts
interface HttpServer {
  tool<TIn, TOut>(
    name: string,
    description: string,
    inputSchema: TypedSchema<TIn>,
    handler: HttpToolHandler<TIn, TOut>,
    outputSchema?: TypedSchema<TOut>
  ): HttpServer;
  registerTool<TIn, TOut>(
    definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
    handler: HttpToolHandler<TIn, TOut>
  ): HttpServer;
  listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

interface HttpServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
  closeAllConnections(): void;
}
```

Invalid typed handler results are treated as server bugs and fail the JSON-RPC call with an internal `ToolError`, matching `tiny-stdio-mcp-server`.

#### `HttpToolContext`

HTTP tool handlers receive request-specific context as their second argument:

```ts
interface HttpToolContext {
  request: AuthenticatedIncomingMessage;
  sessionId?: string;
  auth?: RequestAuthInfo;
}
```

- `request`: the Node.js incoming request for HTTP calls.
- `sessionId`: the `Mcp-Session-Id` request header, or `undefined` for initialization, stateless, and non-HTTP calls.
- `auth`: the verified `RequestAuthInfo` attached to `request.auth`, or `undefined` when the request is unauthenticated.

Calls made directly through `server.handleMessage()` do not have an HTTP request. Their fallback `request` has empty `headers` and `socket` objects, so reads such as `context.request.headers["x-custom-header"]` safely return `undefined`.

## CLI Usage

```sh
tiny-http-mcp-server [options]
```

### Flags

| Flag                                         | Default      | Description                                                                                                                          |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--port <port>`                              | `3000`       | Port to listen on. Use `0` for an ephemeral port.                                                                                    |
| `--hostname <hostname>`                      | `127.0.0.1`  | Hostname/interface to bind to. IPv4, hostnames, and IPv6 literals such as `::1` are supported.                                       |
| `--path <path>`                              | `/mcp`       | MCP endpoint path. `api/mcp` and `/api/mcp` are equivalent.                                                                          |
| `--stateless`                                | off          | Disable session support.                                                                                                             |
| `--json-response`                            | off          | Return `application/json` for `POST` responses.                                                                                      |
| `--allowed-host <host>`                      | loopback     | Allowed `Host` header value. Repeat the flag for multiple hosts.                                                                     |
| `--allowed-origin <url>`                     | none         | Allowed CORS origin. Repeat the flag for multiple origins. Path/query are normalized to the URL origin.                              |
| `--max-request-bytes <bytes>`                | unlimited    | Maximum JSON request body size.                                                                                                      |
| `--max-batch-size <count>`                   | unlimited    | Maximum JSON-RPC batch member count.                                                                                                 |
| `--max-sessions <count>`                     | unlimited    | Maximum active sessions.                                                                                                             |
| `--session-ttl-ms <ms>`                      | none         | Expire idle sessions after this duration.                                                                                            |
| `--max-streams-per-session <count>`          | `1`          | Maximum concurrent GET SSE streams per session.                                                                                      |
| `--max-stream-buffer-bytes <bytes>`          | `1048576`    | End a GET SSE stream before a live notification or keepalive write when buffered bytes exceed this limit.                            |
| `--max-sse-event-history <count>`            | `100`        | Number of SSE events retained for `Last-Event-ID` replay.                                                                            |
| `--sse-keep-alive-ms <ms>`                   | `30000`      | GET SSE keepalive interval in milliseconds. Set to `0` to disable keepalive comments.                                                |
| `--max-concurrent-tool-calls <count>`        | `4`          | Maximum concurrent tool calls across sessions.                                                                                       |
| `--trusted-proxy`                            | off          | Trust `X-Forwarded-Proto` and `X-Forwarded-Host` for metadata challenge URLs.                                                        |
| `--request-timeout-ms <ms>`                  | Node default | Node HTTP request timeout.                                                                                                           |
| `--headers-timeout-ms <ms>`                  | Node default | Node HTTP headers timeout.                                                                                                           |
| `--keep-alive-timeout-ms <ms>`               | Node default | Node HTTP keep-alive timeout.                                                                                                        |
| `--shutdown-grace-ms <ms>`                   | `10000`      | Grace period after the first `SIGINT` or `SIGTERM` before remaining connections are force-closed and the CLI exits non-zero.         |
| `--oauth-resource <uri>`                     | none         | Enable OAuth mode with this canonical protected resource URI. Requires `--oauth-authorization-server` and `--oauth-verifier-module`. |
| `--oauth-authorization-server <issuer>`      | none         | Authorization server issuer URL to publish in metadata. Repeat the flag for multiple issuers.                                        |
| `--oauth-supported-scope <scope>`            | none         | Scope to publish in `scopes_supported`. Repeat the flag for multiple scopes.                                                         |
| `--oauth-required-scope <scope>`             | none         | Scope required on incoming MCP requests. Repeat the flag for multiple scopes.                                                        |
| `--oauth-bearer-method <method>`             | none         | Bearer transport to publish in `bearer_methods_supported`. Repeat the flag for multiple methods.                                     |
| `--oauth-verifier-module <path-or-file-url>` | none         | Module path, `file:` URL, or package specifier that exports the `TokenVerifier` used in CLI mode.                                    |
| `--oauth-verifier-export <name>`             | `default`    | Named export to load from `--oauth-verifier-module`.                                                                                 |
| `--version`                                  | off          | Print the package version and exit.                                                                                                  |
| `-h`, `--help`                               | off          | Print help and exit.                                                                                                                 |

Examples:

```sh
tiny-http-mcp-server --port 8080 --path /api/mcp
tiny-http-mcp-server --port 0 --stateless --json-response
tiny-http-mcp-server \
  --port 8080 \
  --allowed-host mcp.example.com \
  --allowed-origin https://app.example.com \
  --max-request-bytes 1048576 \
  --max-batch-size 16 \
  --max-sessions 1000 \
  --session-ttl-ms 900000 \
  --max-streams-per-session 2 \
  --max-concurrent-tool-calls 32 \
  --request-timeout-ms 30000
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

Supported options:

| Option               | Type                            | Default                                |
| -------------------- | ------------------------------- | -------------------------------------- |
| `name`               | `string`                        | `"conformance-test-server"`            |
| `version`            | `string`                        | `"1.0.0"`                              |
| `enableJsonResponse` | `boolean`                       | inherited default (`false`)            |
| `sessionIdGenerator` | `(() => string) \| undefined`   | inherited default (built-in generator) |
| `oauth`              | `TinyHttpMcpServerOAuthOptions` | none                                   |

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

## Configuration Options

Programmatic configuration is passed through `createHttpServer(options)`, `listenHttp(options)`, OAuth options, and testing helper options documented above. CLI configuration is passed through the flags in [CLI Usage](#cli-usage); there is no config file.

## License

MIT
