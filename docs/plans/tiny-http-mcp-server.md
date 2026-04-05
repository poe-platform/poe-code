# tiny-http-mcp-server

New package implementing MCP [Streamable HTTP transport (2025-03-26 spec)](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http). Depends on `tiny-stdio-mcp-server` for tool registry, schema, content helpers, and JSON-RPC processing. Requires a targeted refactoring of `tiny-stdio-mcp-server` to expose transport-agnostic internals.

---

## 1. Current state analysis

### What lives in `tiny-stdio-mcp-server/src/server.ts` today

```
createServer(options)
  ├── tools: Map<string, ToolDefinition>     ← transport-agnostic
  ├── initialized: boolean                    ← transport-agnostic
  ├── handleRequest(method, params)           ← transport-agnostic (CLOSURED, not exposed)
  ├── processLine(line, write)                ← stdio-specific (line framing)
  ├── sendNotification(method)                ← transport-coupled (writes to ONE active transport)
  │
  ├── Server.tool()                           ← transport-agnostic
  ├── Server.removeTool()                     ← transport-agnostic
  ├── Server.notifyToolsChanged()             ← calls sendNotification (transport-coupled)
  ├── Server.listen()                         ← stdio (stdin/stdout)
  ├── Server.connect(transport)               ← stdio (readline over streams)
  └── Server.connectSDK(transport)            ← SDK transport
```

**Problem:** `handleRequest` is a pure function `(method, params) → { result?, error? }` but it's trapped inside the closure. The HTTP transport cannot call it. The `sendNotification` function only writes to a single active transport — HTTP needs to push notifications to multiple SSE connections.

### What's fully reusable without changes

| Module | Contents | Transport dependency |
|--------|----------|---------------------|
| `schema.ts` | `defineSchema()`, `TypedSchema<T>` | None |
| `jsonrpc.ts` | `parseMessage()`, `formatSuccessResponse()`, `formatErrorResponse()` | None |
| `types.ts` | JSON-RPC types, `ToolDefinition`, `CallToolResult`, `ContentItem`, etc. | `Transport` and `SDKTransport` types are stdio-specific but harmless |
| `content/*` | `Image`, `Audio`, `File`, `toContentBlocks()` | None |

These are already exported from `tiny-stdio-mcp-server` and will be re-exported by `tiny-http-mcp-server`.

---

## 2. Refactoring `tiny-stdio-mcp-server`

### Goal

Expose two new members on the `Server` interface so external transports can reuse the core logic without duplicating it.

### 2.1 New `Server` interface

```ts
// server.ts — updated interface

export interface HandleResult {
  result?: unknown;
  error?: { code: number; message: string };
}

export interface Server {
  // Tool registration (UNCHANGED)
  tool<T>(name: string, description: string, inputSchema: TypedSchema<T>, handler: ToolHandler<T>): Server;
  removeTool(name: string): boolean;
  notifyToolsChanged(): Promise<void>;

  // Transport bindings (UNCHANGED)
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;

  // NEW — transport-agnostic core
  handleMessage(method: string, params?: Record<string, unknown>): Promise<HandleResult>;
  onNotification(listener: (notification: JSONRPCNotification) => void): () => void;
}
```

### 2.2 `handleMessage(method, params)` — expose existing logic

This is the existing `handleRequest` closure variable, promoted to the public interface. **Zero logic changes.** The function already has the correct signature and behavior:

```ts
// current (closured)
const handleRequest = async (method, params) => {
  if (method === "ping") return { result: {} };
  if (method === "initialize") { ... }
  if (method === "tools/list") { ... }
  if (method === "tools/call") { ... }
  return { error: { code: -32601, message: "Method not found" } };
};

// new (same function, now on the interface)
server.handleMessage = handleRequest;
```

Consumers:
- `connect()` and `connectSDK()` call it internally (already do, just via closure)
- HTTP transport calls it externally for each JSON-RPC request in a POST body
- MCP SDK integration tests can call it directly

### 2.3 `onNotification(listener)` — notification pub/sub

Replace the single-transport `sendNotification` with a listener pattern:

```ts
// Inside createServer():
const notificationListeners = new Set<(n: JSONRPCNotification) => void>();

const broadcastNotification = async (method: string): Promise<void> => {
  const notification: JSONRPCNotification = { jsonrpc: "2.0", method };
  for (const listener of notificationListeners) {
    listener(notification);
  }
};

// On the server object:
server.onNotification = (listener) => {
  notificationListeners.add(listener);
  return () => { notificationListeners.delete(listener); };
};

server.notifyToolsChanged = async () => {
  if (initialized) {
    await broadcastNotification("notifications/tools/list_changed");
  }
};
```

The existing `connect()` and `connectSDK()` register themselves as listeners:

```ts
// connect() — currently writes directly to transport.writable
async connect(transport: Transport): Promise<void> {
  const unsubscribe = server.onNotification((notification) => {
    transport.writable.write(JSON.stringify(notification) + "\n");
  });

  // ... existing readline logic using server.handleMessage ...

  rl.on("close", () => {
    unsubscribe();
    resolve();
  });
}
```

### 2.4 Changes to `connect()` and `connectSDK()` internals

Both methods change from calling the closured `handleRequest` to calling `server.handleMessage`. Both register a notification listener and unsubscribe on close. This is a mechanical refactor — behavior is identical.

**`connect(transport)`** before:
```ts
rl.on("line", (line) => {
  processLine(line, (data) => transport.writable.write(data));
});
```

**`connect(transport)`** after:
```ts
rl.on("line", async (line) => {
  const parsed = parseMessage(line);
  if (!parsed.success) {
    transport.writable.write(formatErrorResponse(parsed.id, parsed.error) + "\n");
    return;
  }
  const { request, isNotification } = parsed;
  const { result, error } = await server.handleMessage(request.method, request.params);
  if (isNotification) return;
  const req = request as JSONRPCRequest;
  if (error) transport.writable.write(formatErrorResponse(req.id, error) + "\n");
  else if (result !== undefined) transport.writable.write(formatSuccessResponse(req.id, result) + "\n");
});
```

This is the same logic that `processLine` currently does — we're just calling `server.handleMessage` instead of the closured `handleRequest`. The `processLine` helper can be removed or kept as a private.

**`connectSDK(transport)`** — same pattern, replace closured `handleRequest` call with `server.handleMessage`.

### 2.5 Type exports

Add to `types.ts`:

```ts
export interface HandleResult {
  result?: unknown;
  error?: { code: number; message: string };
}
```

Add to `index.ts` exports:

```ts
export type { HandleResult } from "./types.js";
```

### 2.6 Backward compatibility

| Concern | Status |
|---------|--------|
| `createServer()` return type | Extended (new optional members). All existing code works. |
| `Server` interface | Two new members. Existing implementations don't break because they don't implement the interface — they use the returned object. |
| All existing tests | Pass without changes. Same behavior, just routed through public method instead of closure. |
| External consumers (terminal-pilot-mcp, poe-code MCP, etc.) | Zero changes needed. They call `createServer().tool().listen()`. |

### 2.7 Files changed in `tiny-stdio-mcp-server`

| File | Change |
|------|--------|
| `src/types.ts` | Add `HandleResult` interface |
| `src/server.ts` | Add `handleMessage` and `onNotification` to `Server` interface. Refactor `createServer()` internals to use notification listeners instead of direct transport writes. |
| `src/index.ts` | Export `HandleResult` type |

### 2.8 Refactoring test plan

These verify the refactoring doesn't break anything and that the new API works.

**Existing tests (MUST still pass, zero changes):**

| File | Tests | Expected |
|------|-------|----------|
| `src/server.test.ts` | All stdio-based tests (ping, initialize, tools/list, tools/call, removeTool, notifyToolsChanged) | Pass unchanged |
| `src/testing.test.ts` | All SDK client integration tests | Pass unchanged |
| `src/jsonrpc.test.ts` | JSON-RPC parsing/formatting | Pass unchanged (no changes to this file) |
| `src/schema.test.ts` | Schema definition | Pass unchanged (no changes to this file) |
| `src/content/*.test.ts` | Content helpers | Pass unchanged (no changes to these files) |

**New tests for `handleMessage` (add to `server.test.ts`):**

| # | Test case | Description |
|---|-----------|-------------|
| 1 | `handleMessage("ping")` returns `{ result: {} }` | Direct call, no transport |
| 2 | `handleMessage("initialize", {})` returns InitializeResult | Sets initialized state |
| 3 | `handleMessage("tools/list")` returns tool list after initialize | Requires prior initialize call |
| 4 | `handleMessage("tools/list")` returns error before initialize | Server not initialized |
| 5 | `handleMessage("tools/call", { name, arguments })` invokes handler | Returns tool result |
| 6 | `handleMessage("tools/call", { name: "missing" })` returns error | Tool not found |
| 7 | `handleMessage("unknown/method")` returns METHOD_NOT_FOUND | -32601 error |
| 8 | `handleMessage("notifications/initialized")` returns `{ result: undefined }` | Notification handling |

**New tests for `onNotification` (add to `server.test.ts`):**

| # | Test case | Description |
|---|-----------|-------------|
| 9 | `onNotification` receives tools/list_changed after `notifyToolsChanged()` | Listener called |
| 10 | multiple listeners all receive notification | Pub/sub works |
| 11 | unsubscribe prevents further notifications | Returned function works |
| 12 | `notifyToolsChanged()` before initialize sends nothing | No notifications |
| 13 | listener added after initialize receives future notifications | Late subscription |

---

## 3. New package: `tiny-http-mcp-server`

### 3.1 Two modes of operation

The package supports two distinct ways to run an HTTP MCP server:

**Mode 1 — Standalone CLI / `listenHttp()`**

Launch a self-contained HTTP server with a single command or function call. No Express, no external framework.

```sh
# CLI binary
npx tiny-http-mcp-server --port 3000

# Programmatic
const handle = await server.listenHttp({ port: 3000 });
```

Internally uses Node.js `http.createServer`. Good for dedicated MCP servers, development, CI.

**Mode 2 — Express middleware mount**

Mount the MCP handler into an existing Express app alongside other routes/middleware.

```ts
import express from "express";
import { createHttpServer, createExpressMiddleware } from "tiny-http-mcp-server";

const app = express();
const mcpServer = createHttpServer({ name: "my-api", version: "1.0.0" })
  .tool("greet", "Greet", schema, ({ name }) => `Hello ${name}`);

app.use("/mcp", createExpressMiddleware(mcpServer));
app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(3000);
```

Good for production services that already have Express for health checks, auth middleware, other API routes.

Both modes use the same `StreamableHttpTransport` core — the difference is only in how HTTP requests reach it.

### 3.2 Package structure

```
packages/tiny-http-mcp-server/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts                  # public API: createHttpServer, createExpressMiddleware, re-exports
    ├── cli.ts                    # #!/usr/bin/env node — standalone CLI entry point
    ├── http-server.ts            # createHttpServer() — wraps createServer with HTTP methods
    ├── http-server.test.ts       # integration tests (standalone + Express mount)
    ├── http-transport.ts         # StreamableHttpTransport class — core HTTP handling
    ├── http-transport.test.ts    # unit tests for the transport (low-level request handling)
    ├── express-middleware.ts      # createExpressMiddleware() — Express adapter
    ├── express-middleware.test.ts # Express-specific tests
    ├── sse.ts                    # SSE event formatting
    ├── sse.test.ts
    ├── parse-body.ts             # JSON-RPC body parsing + classification
    ├── parse-body.test.ts
    ├── session.ts                # Session ID generation + store
    ├── session.test.ts
    └── testing.ts                # createHttpTestPair() test helper
```

### 3.3 Dependencies

```json
{
  "name": "tiny-http-mcp-server",
  "version": "0.1.0",
  "description": "Streamable HTTP transport for tiny MCP servers",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "tiny-http-mcp-server": "dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "tsc"
  },
  "files": ["dist", "!dist/testing.*"],
  "engines": { "node": ">=18" },
  "dependencies": {
    "tiny-stdio-mcp-server": "*"
  },
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^1.25.3",
    "express": "^5.1.0",
    "@types/express": "^5.0.2"
  },
  "peerDependencies": {
    "express": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "express": { "optional": true }
  },
  "keywords": ["mcp", "model-context-protocol", "http", "sse", "server", "streamable-http", "express"]
}
```

Runtime dependencies: `tiny-stdio-mcp-server` only. Express is an **optional peer dependency** — the core standalone server works without it. Import `createExpressMiddleware` only when Express is available.

### 3.4 Public API

#### `createHttpServer(options)`

```ts
import { createServer, type Server, type ServerOptions } from "tiny-stdio-mcp-server";

export interface HttpServer extends Server {
  listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function createHttpServer(options: ServerOptions & HttpTransportOptions): HttpServer;
```

#### `createExpressMiddleware(server)`

```ts
import type { RequestHandler } from "express";

export function createExpressMiddleware(server: HttpServer): RequestHandler;
```

Returns an Express middleware that handles POST, GET, and DELETE on whatever path it's mounted at. Express handles body parsing, routing, and other middleware — this adapter just bridges `req`/`res` to `server.handleRequest()`.

The middleware:
- Calls `server.handleRequest(req, res)` for POST, GET, DELETE
- Returns 405 for other methods
- Does NOT parse the body itself (relies on `server.handleRequest` reading from the stream, or on `express.json()` if the user adds it — both work because `parse-body.ts` accepts pre-parsed bodies via `req.body`)

#### Types

```ts
export interface HttpTransportOptions {
  /** Generate session IDs. Default: crypto.randomUUID. Set to undefined for stateless mode. */
  sessionIdGenerator?: (() => string) | undefined;
  /** Return JSON instead of SSE for POST responses. Default: false */
  enableJsonResponse?: boolean;
}

export interface HttpListenOptions {
  /** Port. Default: 0 (random) */
  port?: number;
  /** Hostname. Default: "127.0.0.1" */
  hostname?: string;
  /** MCP endpoint path. Default: "/mcp" */
  path?: string;
  /** Abort signal for shutdown */
  signal?: AbortSignal;
}

export interface HttpServerHandle {
  /** Full URL, e.g. "http://127.0.0.1:3456/mcp" */
  url: string;
  /** Resolved port */
  port: number;
  /** Shut down the server and close all connections */
  close(): Promise<void>;
}
```

#### CLI

```
Usage: tiny-http-mcp-server [options]

Options:
  --port <number>      Port to listen on (default: 3000)
  --hostname <string>  Hostname to bind (default: 127.0.0.1)
  --path <string>      MCP endpoint path (default: /mcp)
  --stateless          Disable session management
  --json-response      Return JSON instead of SSE for POST responses
  -h, --help           Show help
```

The CLI creates a minimal server with no tools. It's a starting point — real servers import the library and register tools programmatically.

For existing MCP servers (like `terminal-pilot-mcp`), the pattern would be to add a `--http` flag or a separate bin entry that starts the HTTP transport instead of stdio:

```ts
// terminal-pilot-mcp/src/cli-http.ts
#!/usr/bin/env node
import { createTerminalPilotMcpServer } from "./mcp-server.js";
import { TerminalPilot } from "terminal-pilot";

const agent = await TerminalPilot.launch();
const server = createTerminalPilotMcpServer(agent);
// server is a base Server — wrap it for HTTP
// (This shows the composability: any tiny-stdio-mcp-server can become HTTP)
```

#### Re-exports

`index.ts` re-exports everything from `tiny-stdio-mcp-server` so users can import from a single package:

```ts
// Re-export everything from the base package
export {
  createServer,
  defineSchema,
  Image, Audio, File,
  toContentBlocks, fileTypeFromBuffer,
  JSON_RPC_ERROR_CODES,
} from "tiny-stdio-mcp-server";

export type {
  Server, ServerOptions, TypedSchema,
  ToolHandler, ToolDefinition, Tool,
  CallToolResult, ContentItem, HandleResult,
  JSONSchema, JSONSchemaProperty,
  Transport, SDKTransport,
  JSONRPCRequest, JSONRPCResponse, JSONRPCError,
  JSONRPCMessage, JSONRPCNotification,
  InitializeResult,
  ImageContent, AudioContent, EmbeddedResource,
  TextResourceContents, BlobResourceContents,
  ContentBlock, TextContent, FileTypeResult, ToolReturn,
} from "tiny-stdio-mcp-server";

// HTTP-specific exports
export { createHttpServer } from "./http-server.js";
export { createExpressMiddleware } from "./express-middleware.js";
export type { HttpServer, HttpTransportOptions, HttpListenOptions, HttpServerHandle } from "./http-server.js";
```

### 3.5 Usage examples

**Mode 1a — Standalone server (programmatic):**
```ts
import { createHttpServer, defineSchema } from "tiny-http-mcp-server";

const server = createHttpServer({ name: "my-api", version: "1.0.0" })
  .tool("greet", "Say hello", defineSchema({ name: { type: "string" } }), ({ name }) => {
    return `Hello, ${name}!`;
  });

const handle = await server.listenHttp({ port: 3000 });
console.log(`MCP server at ${handle.url}`);
```

**Mode 1b — Standalone server (CLI):**
```sh
npx tiny-http-mcp-server --port 3000
# → MCP server listening at http://127.0.0.1:3000/mcp
```

**Mode 2a — Express middleware mount:**
```ts
import express from "express";
import { createHttpServer, createExpressMiddleware, defineSchema } from "tiny-http-mcp-server";

const mcpServer = createHttpServer({ name: "my-api", version: "1.0.0" })
  .tool("greet", "Greet", defineSchema({ name: { type: "string" } }), ({ name }) => `Hello ${name}`);

const app = express();
app.use("/mcp", createExpressMiddleware(mcpServer));
app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(3000);
```

**Mode 2b — Express with auth middleware:**
```ts
import express from "express";
import { createHttpServer, createExpressMiddleware, defineSchema } from "tiny-http-mcp-server";

const mcpServer = createHttpServer({ name: "my-api", version: "1.0.0" })
  .tool("secret", "Secret tool", defineSchema({}), () => "top secret");

const app = express();

// Auth middleware runs BEFORE MCP handler
app.use("/mcp", (req, res, next) => {
  if (req.headers.authorization !== "Bearer my-token") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}, createExpressMiddleware(mcpServer));

app.listen(3000);
```

**Mode 3 — Bring-your-own HTTP server (raw Node.js):**
```ts
import http from "node:http";
import { createHttpServer, defineSchema } from "tiny-http-mcp-server";

const mcpServer = createHttpServer({ name: "my-api", version: "1.0.0" })
  .tool("greet", "Greet", defineSchema({ name: { type: "string" } }), ({ name }) => `Hello ${name}`);

const httpServer = http.createServer(async (req, res) => {
  if (new URL(req.url!, `http://${req.headers.host}`).pathname === "/mcp") {
    await mcpServer.handleRequest(req, res);
  } else {
    res.writeHead(404).end();
  }
});
httpServer.listen(3000);
```

**Stateless (no sessions):**
```ts
const server = createHttpServer({
  name: "stateless", version: "1.0.0",
  sessionIdGenerator: undefined,
});
```

---

## 4. Module design

### 4.1 `sse.ts` — SSE event formatting

```ts
export interface SseEvent {
  data: string;
  id?: string;
  event?: string;
}

/** Format a single SSE event. Returns string ending with \n\n */
export function formatSseEvent(event: SseEvent): string;

/** SSE headers for a response */
export const SSE_HEADERS: Record<string, string>;
```

Reuse opportunity: `tiny-mcp-client` already has an `SseParser` for *reading* SSE. This module is for *writing* SSE. Complementary, no overlap.

### 4.2 `parse-body.ts` — JSON-RPC body classification

```ts
export interface ClassifiedBody {
  messages: JSONRPCMessage[];
  hasRequests: boolean;
  hasNotifications: boolean;
  hasResponses: boolean;
  requests: JSONRPCRequest[];
  notifications: JSONRPCNotification[];
  responses: JSONRPCResponse[];
}

/** Read body from IncomingMessage, parse as JSON, classify messages */
export async function readAndClassifyBody(
  req: IncomingMessage,
  preParsed?: unknown
): Promise<ClassifiedBody>;
```

Uses `parseMessage` from `tiny-stdio-mcp-server/jsonrpc` for individual message validation. Does NOT re-implement JSON-RPC parsing.

### 4.3 `session.ts` — Session store

```ts
export interface Session {
  id: string;
  initialized: boolean;
  createdAt: number;
}

export interface SessionStore {
  create(id: string): Session;
  get(id: string): Session | undefined;
  delete(id: string): boolean;
  has(id: string): boolean;
}

export function createSessionStore(): SessionStore;
export function defaultSessionIdGenerator(): string; // crypto.randomUUID()
```

### 4.4 `http-transport.ts` — Core transport

```ts
import type { Server } from "tiny-stdio-mcp-server";

export interface StreamableHttpTransportOptions {
  sessionIdGenerator?: (() => string) | undefined;
  enableJsonResponse?: boolean;
}

export class StreamableHttpTransport {
  constructor(server: Server, options?: StreamableHttpTransportOptions);

  /** Handle an incoming HTTP request (POST, GET, DELETE) */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;

  /** Close all active SSE connections and clean up */
  close(): Promise<void>;
}
```

Internal state:
- `sessionStore: SessionStore` — active sessions
- `sseStreams: Map<string, Set<ServerResponse>>` — open GET SSE connections per session (stateful) or a single set (stateless)
- `notificationUnsubscribe: () => void` — unsubscribe from `server.onNotification`

**How it uses `tiny-stdio-mcp-server`:**

```
POST /mcp body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  │
  ├── readAndClassifyBody(req)                    ← parse-body.ts
  │     uses parseMessage() from tiny-stdio-mcp-server/jsonrpc
  │
  ├── sessionStore.get(req.headers["mcp-session-id"])  ← session.ts
  │
  ├── For each request in body:
  │     server.handleMessage(method, params)       ← tiny-stdio-mcp-server (refactored)
  │     │
  │     └── returns { result } or { error }
  │
  ├── Format response:
  │     formatSuccessResponse(id, result)          ← tiny-stdio-mcp-server/jsonrpc
  │     or formatErrorResponse(id, error)          ← tiny-stdio-mcp-server/jsonrpc
  │
  └── Write as JSON or SSE:
        formatSseEvent({ data: response })         ← sse.ts
```

For server-initiated notifications (GET SSE):

```
server.onNotification((notification) => {
  // Write to all connected GET SSE streams for this session
  for (const res of sseStreams.get(sessionId)) {
    res.write(formatSseEvent({ data: JSON.stringify(notification) }));
  }
});
```

### 4.5 `http-server.ts` — Convenience wrapper

```ts
export function createHttpServer(options: ServerOptions & HttpTransportOptions): HttpServer {
  const server = createServer(options);
  const transport = new StreamableHttpTransport(server, options);

  return Object.assign(server, {
    async listenHttp(listenOptions?: HttpListenOptions): Promise<HttpServerHandle> {
      const { port = 0, hostname = "127.0.0.1", path = "/mcp", signal } = listenOptions ?? {};
      const httpServer = http.createServer(async (req, res) => {
        if (new URL(req.url!, `http://${req.headers.host}`).pathname === path) {
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(404).end();
        }
      });
      // listen, return handle with url/port/close
    },

    handleRequest: transport.handleRequest.bind(transport),
  });
}
```

### 4.6 `express-middleware.ts` — Express adapter

```ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { HttpServer } from "./http-server.js";

export function createExpressMiddleware(server: HttpServer): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await server.handleRequest(req, res);
    } catch (err) {
      next(err);
    }
  };
}
```

This is intentionally thin — a single function that bridges Express `req`/`res` (which extend `IncomingMessage`/`ServerResponse`) to the transport's `handleRequest`. All HTTP method routing (POST/GET/DELETE/405) is handled inside `StreamableHttpTransport`, not in the middleware.

Why keep it separate:
- Express is an **optional** peer dep — if users don't install Express, the core works fine
- Users who import only `createHttpServer` + `listenHttp` never pull in the Express types
- The middleware is importable: `import { createExpressMiddleware } from "tiny-http-mcp-server"`

Express-specific concerns the middleware does NOT handle (user responsibility):
- Body parsing (`express.json()`) — not needed, `parse-body.ts` reads from the raw stream. But if the user adds `express.json()`, `parse-body.ts` detects `req.body` and uses it.
- Auth — user adds auth middleware before the MCP middleware
- CORS — user adds `cors()` middleware
- Rate limiting — user adds rate limiter
- Path mounting — Express `app.use("/mcp", middleware)` handles the path prefix

### 4.7 `cli.ts` — Standalone CLI entry point

```ts
#!/usr/bin/env node
import { createHttpServer } from "./http-server.js";

const args = parseArgs(process.argv.slice(2));
const server = createHttpServer({
  name: "tiny-http-mcp-server",
  version: packageJson.version,
  ...(args.stateless ? { sessionIdGenerator: undefined } : {}),
  ...(args.jsonResponse ? { enableJsonResponse: true } : {}),
});

const handle = await server.listenHttp({
  port: args.port ?? 3000,
  hostname: args.hostname ?? "127.0.0.1",
  path: args.path ?? "/mcp",
});

console.log(`MCP server listening at ${handle.url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  await handle.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await handle.close();
  process.exit(0);
});
```

Uses a minimal `parseArgs` helper (Node.js built-in `util.parseArgs` or a 10-line manual parser). No commander dependency for this simple CLI. The CLI starts a server with no tools — it's primarily useful for:
1. Verifying the package works: `npx tiny-http-mcp-server --port 3000`
2. As a base for testing clients against a live HTTP MCP endpoint
3. As a template showing the minimal code needed

Real MCP servers would import the library and register tools, then either call `listenHttp()` or use `createExpressMiddleware()`.

### 4.8 `testing.ts` — Test helper

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpServer } from "./http-server.js";

export interface HttpTestPair {
  client: Client;
  handle: HttpServerHandle;
  url: string;
  cleanup: () => Promise<void>;
}

export async function createHttpTestPair(server: HttpServer): Promise<HttpTestPair> {
  const handle = await server.listenHttp({ port: 0 });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(handle.url));
  await client.connect(transport);
  return {
    client,
    handle,
    url: handle.url,
    cleanup: async () => {
      await client.close();
      await handle.close();
    },
  };
}
```

---

## 5. Streamable HTTP spec compliance matrix

Spec reference: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http

| Spec requirement | Implementation location | Notes |
|-----------------|------------------------|-------|
| Single MCP endpoint for POST + GET | `http-transport.ts` | Path configurable via `HttpListenOptions.path` |
| POST: JSON-RPC request/notification/response/batch | `parse-body.ts` → `http-transport.ts` | |
| POST: `Accept: application/json, text/event-stream` | `http-transport.ts` | Validated but lenient |
| POST: notifications/responses only → 202 | `http-transport.ts` | |
| POST: requests → `text/event-stream` or `application/json` | `http-transport.ts` | Controlled by `enableJsonResponse` |
| POST: SSE stream includes response per request | `http-transport.ts` + `sse.ts` | |
| POST: server MAY send notifications before response in SSE | Supported via notification listeners | |
| POST: stream closes after all responses | `http-transport.ts` | |
| GET: returns `text/event-stream` or 405 | `http-transport.ts` | 405 in stateless mode |
| GET: server pushes notifications/requests | `http-transport.ts` via `server.onNotification` | |
| GET: MUST NOT send response on GET stream | `http-transport.ts` | Only notifications |
| DELETE: terminates session | `http-transport.ts` + `session.ts` | |
| DELETE: 405 if not supported | `http-transport.ts` | In stateless mode |
| Session: `Mcp-Session-Id` header on InitializeResult | `http-transport.ts` | |
| Session: client MUST include on subsequent requests | `http-transport.ts` validation | |
| Session: missing → 400, invalid → 404 | `http-transport.ts` + `session.ts` | |
| Session: stateless mode (no session ID) | `sessionIdGenerator: undefined` | |
| Unsupported methods: 405 | `http-transport.ts` | PUT, PATCH, etc. |
| Security: validate Origin header | Phase 2 (optional in spec) | |
| Security: bind to localhost | Default hostname `127.0.0.1` | |
| Resumability: SSE event IDs | Phase 2 | |
| Resumability: Last-Event-ID reconnection | Phase 2 | |
| Multiple SSE connections | `http-transport.ts` | Messages sent to one stream only |
| Batch support | `parse-body.ts` + `http-transport.ts` | Batch requests + batch responses |

---

## 6. Complete test plan

### 6.1 `tiny-stdio-mcp-server` refactoring tests

All existing tests must continue passing with zero modifications. New tests:

#### `server.test.ts` — new `handleMessage` describe block

| # | Test | Assertion |
|---|------|-----------|
| R1 | `handleMessage("ping")` → `{ result: {} }` | Direct call without transport |
| R2 | `handleMessage("initialize", {})` → InitializeResult | Contains serverInfo, capabilities, protocolVersion |
| R3 | `handleMessage("tools/list")` after initialize → tool list | Lists registered tools |
| R4 | `handleMessage("tools/list")` before initialize → error | `{ error: { code: -32600, message: "Server not initialized" } }` |
| R5 | `handleMessage("tools/call", { name: "greet", arguments: { name: "World" } })` → tool result | `{ result: { content: [{ type: "text", text: "Hello, World!" }] } }` |
| R6 | `handleMessage("tools/call", { name: "missing" })` → error | `{ error: { code: -32602, message: "Tool not found: missing" } }` |
| R7 | `handleMessage("tools/call", {})` → error | `{ error: { code: -32602, message: "Tool name required" } }` |
| R8 | `handleMessage("unknown/method")` → METHOD_NOT_FOUND | `{ error: { code: -32601 } }` |
| R9 | `handleMessage("notifications/initialized")` → `{ result: undefined }` | No error, undefined result (notification-like) |
| R10 | `handleMessage` with throwing tool handler → isError result | `{ result: { content: [...], isError: true } }` |

#### `server.test.ts` — new `onNotification` describe block

| # | Test | Assertion |
|---|------|-----------|
| R11 | listener receives `notifications/tools/list_changed` | Called after `notifyToolsChanged()` |
| R12 | multiple listeners all receive notification | Both called |
| R13 | unsubscribe prevents further notifications | Listener not called after unsubscribe |
| R14 | `notifyToolsChanged()` before initialize is silent | Listener not called |
| R15 | listener added after initialize works | Receives future notifications |
| R16 | notification has correct JSON-RPC shape | `{ jsonrpc: "2.0", method: "notifications/tools/list_changed" }` |
| R17 | unsubscribe is idempotent | Calling twice doesn't throw |

#### Verify existing tests still pass

| File | Test count (approx) | Change needed |
|------|---------------------|---------------|
| `server.test.ts` | ~40 tests | None (existing), +17 new |
| `testing.test.ts` | ~25 tests | None |
| `jsonrpc.test.ts` | ~15 tests | None |
| `schema.test.ts` | ~5 tests | None |
| `content/*.test.ts` | ~20 tests | None |

### 6.2 `tiny-http-mcp-server` tests

#### `sse.test.ts` — SSE formatting

| # | Test | Assertion |
|---|------|-----------|
| S1 | formats basic SSE event with data only | `"data: {\"jsonrpc\":\"2.0\"}\n\n"` |
| S2 | formats event with id field | `"id: evt-1\ndata: ...\n\n"` |
| S3 | formats event with event type | `"event: message\ndata: ...\n\n"` |
| S4 | formats event with all fields | id, event, data in correct order |
| S5 | handles empty data string | `"data: \n\n"` |
| S6 | handles data with special characters | JSON with quotes, unicode, emoji |
| S7 | SSE_HEADERS contains correct content-type | `"text/event-stream"` |
| S8 | SSE_HEADERS contains cache-control | `"no-cache"` |
| S9 | SSE_HEADERS contains connection | `"keep-alive"` |

#### `parse-body.test.ts` — Body parsing + classification

| # | Test | Assertion |
|---|------|-----------|
| P1 | parses single JSON-RPC request | `hasRequests: true`, requests array has 1 entry |
| P2 | parses single JSON-RPC notification | `hasNotifications: true`, notifications array has 1 entry |
| P3 | parses single JSON-RPC response | `hasResponses: true`, responses array has 1 entry |
| P4 | parses batch of requests | Array of 3 requests → `requests.length === 3` |
| P5 | parses batch of notifications | Array of 2 notifications |
| P6 | parses batch of responses | Array of 2 responses |
| P7 | parses mixed batch (requests + notifications) | `hasRequests: true, hasNotifications: true` |
| P8 | classifies requests-only body | `hasNotifications: false, hasResponses: false` |
| P9 | classifies notifications-only body | `hasRequests: false, hasResponses: false` |
| P10 | classifies responses-only body | `hasRequests: false, hasNotifications: false` |
| P11 | rejects invalid JSON string | Throws with parse error |
| P12 | rejects non-object body (number) | Throws |
| P13 | rejects non-object body (string) | Throws |
| P14 | rejects non-object body (null) | Throws |
| P15 | rejects message missing jsonrpc field | Throws |
| P16 | rejects empty array | Throws |
| P17 | accepts pre-parsed body object | Skips reading from stream |
| P18 | accepts pre-parsed body array | Skips reading from stream |
| P19 | request identified by presence of method + id | Correctly classified |
| P20 | notification identified by method + no id | Correctly classified |
| P21 | response identified by result/error + id + no method | Correctly classified |

#### `session.test.ts` — Session management

| # | Test | Assertion |
|---|------|-----------|
| SS1 | `defaultSessionIdGenerator()` returns string | Non-empty string |
| SS2 | session IDs are unique | 100 generated IDs → all different |
| SS3 | session ID is visible ASCII (0x21-0x7E) | Regex test |
| SS4 | `createSessionStore().create(id)` stores session | `store.has(id) === true` |
| SS5 | `store.get(id)` returns session | Contains id, initialized, createdAt |
| SS6 | `store.get(unknownId)` returns undefined | |
| SS7 | `store.delete(id)` removes session | `store.has(id) === false` |
| SS8 | `store.delete(unknownId)` returns false | |
| SS9 | `store.has(unknownId)` returns false | |

#### `http-transport.test.ts` — Transport unit tests

These test the `StreamableHttpTransport` directly by creating Node.js `IncomingMessage`/`ServerResponse` mocks (or using the actual `http.createServer` with fetch).

**POST — basic request/response:**

| # | Test | Assertion |
|---|------|-----------|
| T1 | POST initialize → InitializeResult + Mcp-Session-Id | Status 200, session header set |
| T2 | POST initialized notification → 202 | No body |
| T3 | POST tools/list → tool list | JSON or SSE response |
| T4 | POST tools/call → tool result | Handler invoked, result returned |
| T5 | POST JSON-RPC response → 202 | Accepted |

**POST — content-type negotiation:**

| # | Test | Assertion |
|---|------|-----------|
| T6 | `enableJsonResponse: true` → Content-Type: application/json | JSON body |
| T7 | `enableJsonResponse: false` → Content-Type: text/event-stream | SSE body |
| T8 | SSE body contains `data:` lines | Correct SSE format |
| T9 | SSE stream ends after response sent | Connection closes |

**POST — batch:**

| # | Test | Assertion |
|---|------|-----------|
| T10 | batch of 3 requests → 3 responses | All responses returned |
| T11 | batch of notifications → 202 | No responses |
| T12 | mixed batch (2 requests + 1 notification) → 2 responses | Notification doesn't generate response |
| T13 | batch responses in SSE contain all responses | Each as separate SSE event or batched |

**POST — session validation (stateful):**

| # | Test | Assertion |
|---|------|-----------|
| T14 | POST without session after init → 400 | Bad Request |
| T15 | POST with valid session → accepted | Normal response |
| T16 | POST with invalid session → 404 | Not Found |
| T17 | Initialize request doesn't require session | Creates new session |

**POST — errors:**

| # | Test | Assertion |
|---|------|-----------|
| T18 | invalid JSON body → 400 | JSON-RPC parse error in body |
| T19 | empty body → 400 | Error |
| T20 | non-JSON content-type → 400 | Error (or parsed anyway — lenient) |
| T21 | method not found → JSON-RPC -32601 | Error in response |
| T22 | tool throws → isError: true | Error wrapped in content |
| T23 | tool not found → JSON-RPC -32602 | Error in response |
| T24 | tools/call before initialize → error | Server not initialized |

**POST — headers:**

| # | Test | Assertion |
|---|------|-----------|
| T25 | Mcp-Session-Id present on initialize response | Header value matches session |
| T26 | Mcp-Session-Id present on subsequent responses | Same session ID |
| T27 | No Mcp-Session-Id in stateless mode | Header absent |

**GET — SSE stream:**

| # | Test | Assertion |
|---|------|-----------|
| T28 | GET → Content-Type: text/event-stream | SSE stream opened |
| T29 | GET without session (stateful) → 400 | Bad Request |
| T30 | GET with valid session → stream opens | Connection kept alive |
| T31 | `notifyToolsChanged()` → event on GET stream | SSE event received |
| T32 | GET stream closes when transport closes | Clean shutdown |
| T33 | GET in stateless mode → 405 | Method Not Allowed |

**DELETE — session termination:**

| # | Test | Assertion |
|---|------|-----------|
| T34 | DELETE with valid session → 204 | No Content |
| T35 | DELETE invalidates session | POST with that session → 404 |
| T36 | DELETE without session header → 400 | Bad Request |
| T37 | DELETE with unknown session → 404 | Not Found |
| T38 | DELETE in stateless mode → 405 | Method Not Allowed |

**Unsupported methods:**

| # | Test | Assertion |
|---|------|-----------|
| T39 | PUT → 405 | Method Not Allowed |
| T40 | PATCH → 405 | Method Not Allowed |
| T41 | OPTIONS → 405 or 204 (CORS preflight) | Depends on implementation |

#### `http-server.test.ts` — Integration tests

**SDK client (`@modelcontextprotocol/sdk` `StreamableHTTPClientTransport`):**

| # | Test | Assertion |
|---|------|-----------|
| I1 | SDK client initializes, lists tools | Full handshake over HTTP |
| I2 | SDK client calls tool, gets text result | Round-trip |
| I3 | SDK client calls tool, gets structured result | JSON object returned |
| I4 | SDK client calls failing tool, gets isError | Error propagation |
| I5 | SDK client receives tool list change notification | `notifyToolsChanged()` reflected |
| I6 | SDK client terminates session via DELETE | Clean termination |
| I7 | SDK client reconnects after 404 (session expired) | Re-initializes |
| I8 | SDK client with multiple tools | List and call different tools |

**`tiny-mcp-client` `HttpTransport`:**

| # | Test | Assertion |
|---|------|-----------|
| I9 | HttpTransport connects and initializes | Session established |
| I10 | HttpTransport lists tools | Tool list returned |
| I11 | HttpTransport calls tool | Result received |
| I12 | HttpTransport receives SSE response | SSE streaming works |
| I13 | HttpTransport handles session termination on dispose | DELETE sent |

**`listenHttp` convenience:**

| # | Test | Assertion |
|---|------|-----------|
| I14 | starts server on specified port | Fetch succeeds on that port |
| I15 | port 0 picks random available port | `handle.port > 0` |
| I16 | returns correct URL | `handle.url === "http://127.0.0.1:{port}/mcp"` |
| I17 | `handle.close()` shuts down server | Port freed |
| I18 | respects AbortSignal | Signal abort → server closes |
| I19 | custom path `/api/v1/mcp` | URL reflects custom path |
| I20 | defaults to 127.0.0.1 | Hostname correct |
| I21 | non-MCP path returns 404 | e.g. GET /health → 404 |

**Stateless mode:**

| # | Test | Assertion |
|---|------|-----------|
| I22 | no Mcp-Session-Id in any response | Header absent |
| I23 | requests work without session header | No 400 error |
| I24 | DELETE → 405 | Not supported |
| I25 | GET → 405 | Not supported |

**Multiple clients / concurrency:**

| # | Test | Assertion |
|---|------|-----------|
| I26 | two SDK clients with separate sessions | Independent, both work |
| I27 | concurrent tool calls on same session | Both resolve correctly |
| I28 | one client DELETE doesn't affect other | Session isolation |

**Edge cases:**

| # | Test | Assertion |
|---|------|-----------|
| I29 | large JSON-RPC body (100KB+) | Handled correctly |
| I30 | rapid connect/disconnect cycles | No leaked handles |
| I31 | server close while request in flight | Graceful, no crash |
| I32 | tool that returns Image content | Content block transmitted correctly |
| I33 | tool that returns multiple content blocks | Array of content blocks |

#### `express-middleware.test.ts` — Express mount tests

All tests spin up a real Express app with `createExpressMiddleware` and hit it with SDK / fetch.

| # | Test | Assertion |
|---|------|-----------|
| E1 | Express mount: SDK client initializes and lists tools | Full handshake via Express |
| E2 | Express mount: SDK client calls tool | Round-trip through Express |
| E3 | Express mount: POST on mounted path works | `/mcp` handles MCP |
| E4 | Express mount: non-MCP routes still work | `/health` returns 200 |
| E5 | Express mount: GET SSE stream works | Server notifications via Express |
| E6 | Express mount: DELETE session works | Clean termination |
| E7 | Express mount with auth middleware | 401 without token, 200 with token |
| E8 | Express mount: error propagates to Express error handler | `next(err)` called |
| E9 | Express mount with `express.json()` body parser | Pre-parsed body accepted |
| E10 | Express mount at nested path `/api/v1/mcp` | Path prefix handled correctly |
| E11 | Express mount: multiple MCP servers on different paths | `/mcp-a` and `/mcp-b` independent |
| E12 | Express mount: stateless mode works | No session headers |

#### CLI tests (`cli.test.ts`)

| # | Test | Assertion |
|---|------|-----------|
| C1 | CLI starts server on default port 3000 | `curl http://127.0.0.1:3000/mcp` responds |
| C2 | CLI `--port 0` picks random port | Output contains URL with non-zero port |
| C3 | CLI `--hostname 127.0.0.1` binds correctly | Accessible on 127.0.0.1 |
| C4 | CLI `--path /api/mcp` uses custom path | URL reflects custom path |
| C5 | CLI `--stateless` disables sessions | No Mcp-Session-Id header |
| C6 | CLI `--json-response` returns JSON | Content-Type: application/json |
| C7 | CLI `-h` / `--help` shows help and exits | Exit code 0, output contains usage |
| C8 | CLI SIGINT triggers graceful shutdown | Process exits cleanly |

---

### 6.3 Spec conformance test harness

The goal is a **reusable test fixture system** that creates realistic MCP servers with tools exercising every MCP feature, then runs the same conformance suite against both `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` and `tiny-mcp-client` `HttpTransport`. This catches interop bugs between our server and both client implementations.

#### Test fixture: `createTestMcpServer()`

A factory that builds an `HttpServer` pre-loaded with tools covering all MCP content types and behaviors:

```ts
// testing.ts (exported from tiny-http-mcp-server/testing)

export function createTestMcpServer(options?: HttpTransportOptions): HttpServer {
  return createHttpServer({ name: "conformance-test-server", version: "1.0.0", ...options })
    // Text tools
    .tool("echo", "Echo input text", echoSchema, ({ text }) => text)
    .tool("reverse", "Reverse text", reverseSchema, ({ text }) => text.split("").reverse().join(""))
    .tool("uppercase", "Uppercase text", uppercaseSchema, ({ text }) => text.toUpperCase())

    // Structured result tools
    .tool("get_user", "Return user object", getUserSchema, ({ id }) => ({ id, name: "Alice", role: "admin" }))
    .tool("get_list", "Return array", getListSchema, () => [1, 2, 3])

    // Rich content tools
    .tool("get_image", "Return a test image", emptySchema, () => Image.fromBase64(TEST_PNG_B64, "image/png"))
    .tool("get_audio", "Return test audio", emptySchema, () => Audio.fromBase64(TEST_MP3_B64, "audio/mpeg"))
    .tool("get_file", "Return test file", emptySchema, () => File.fromText("hello,world", "text/csv"))
    .tool("get_mixed", "Return mixed content", emptySchema, () => [
      Image.fromBase64(TEST_PNG_B64, "image/png"),
      "Caption for the image",
    ])

    // Error tools
    .tool("throw_sync", "Throws synchronously", emptySchema, () => { throw new Error("sync boom"); })
    .tool("throw_async", "Throws asynchronously", emptySchema, async () => { throw new Error("async boom"); })

    // Edge case tools
    .tool("empty_result", "Returns undefined", emptySchema, () => undefined)
    .tool("slow", "Takes 100ms", emptySchema, async () => {
      await new Promise(r => setTimeout(r, 100));
      return "done";
    })
    .tool("large_output", "Returns 100KB", emptySchema, () => "x".repeat(100_000));
}
```

#### Test fixture: `createHttpTestPair()` and `createHttpTestPairWithTinyClient()`

Two variants — one per client implementation:

```ts
// Using MCP SDK client
export async function createHttpTestPair(
  server: HttpServer
): Promise<HttpTestPair> {
  const handle = await server.listenHttp({ port: 0 });
  const client = new Client({ name: "sdk-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(handle.url));
  await client.connect(transport);
  return { client, handle, url: handle.url, cleanup };
}

// Using tiny-mcp-client HttpTransport
export async function createHttpTestPairWithTinyClient(
  server: HttpServer
): Promise<TinyHttpTestPair> {
  const handle = await server.listenHttp({ port: 0 });
  const client = new McpClient();
  const transport = new HttpTransport({ url: handle.url });
  await client.connect(transport);
  return { client, handle, url: handle.url, cleanup };
}
```

#### Spec conformance test suite: `spec-conformance.test.ts`

This is a **separate test file** that systematically tests every MUST/SHOULD/MAY from the MCP Streamable HTTP spec against a real HTTP server. Each test is tagged with the spec section it validates.

The suite runs **twice** — once with the SDK client, once with `tiny-mcp-client` — using `describe.each` or a shared test factory.

| # | Spec section | Test | Description |
|---|-------------|------|-------------|
| **Sending Messages to the Server (POST)** | | | |
| SC1 | POST §1 | client sends JSON-RPC via POST | Verify POST is accepted |
| SC2 | POST §2 | client includes Accept header | `application/json, text/event-stream` |
| SC3 | POST §3a | single request body accepted | Not an array |
| SC4 | POST §3b | batch request body accepted | Array of requests |
| SC5 | POST §3c | batch notifications body accepted | Array of notifications |
| SC6 | POST §3d | batch responses body accepted | Array of responses |
| SC7 | POST §4 | notification-only POST → 202 | No body returned |
| SC8 | POST §4 | response-only POST → 202 | No body returned |
| SC9 | POST §5a | request POST → SSE response | `Content-Type: text/event-stream` |
| SC10 | POST §5b | request POST → JSON response | `Content-Type: application/json` (enableJsonResponse) |
| SC11 | POST §6a | SSE stream has response per request | Each request gets a JSON-RPC response |
| SC12 | POST §6b | SSE stream may include server notifications | `notifyToolsChanged` during tool call |
| SC13 | POST §6c | SSE stream closes after all responses | Connection ends |
| **Listening for Messages (GET)** | | | |
| SC14 | GET §1 | client opens GET SSE stream | Stream established |
| SC15 | GET §2 | client includes Accept: text/event-stream | Header present |
| SC16 | GET §3a | server returns text/event-stream | Content-Type correct |
| SC17 | GET §3b | server returns 405 when GET not supported | Stateless mode |
| SC18 | GET §4a | server pushes notification on GET stream | `notifyToolsChanged` arrives |
| SC19 | GET §4b | server does NOT send response on GET stream | Responses only on POST SSE |
| **Session Management** | | | |
| SC20 | Session §1 | server assigns Mcp-Session-Id on initialize | Header present on InitializeResult |
| SC21 | Session §1 | session ID is visible ASCII (0x21-0x7E) | Regex validation |
| SC22 | Session §2 | client includes session ID on subsequent requests | Server accepts |
| SC23 | Session §2 | missing session ID on non-init request → 400 | Bad Request |
| SC24 | Session §3 | server terminates session → 404 on subsequent requests | After DELETE |
| SC25 | Session §4 | client re-initializes after 404 | New session established |
| SC26 | Session §5 | client sends DELETE to terminate session | Clean shutdown |
| SC27 | Session §5 | server returns 405 for DELETE when unsupported | Stateless mode |
| **Unsupported methods** | | | |
| SC28 | General | PUT returns 405 | Method Not Allowed |
| SC29 | General | PATCH returns 405 | Method Not Allowed |
| **Tool content types** | | | |
| SC30 | Content | text tool result round-trips | `echo("hello")` → `"hello"` |
| SC31 | Content | structured JSON result round-trips | Object serialized as JSON text |
| SC32 | Content | Image content round-trips | Base64 PNG preserved |
| SC33 | Content | Audio content round-trips | Base64 MP3 preserved |
| SC34 | Content | File content round-trips | Text CSV preserved |
| SC35 | Content | mixed content (Image + text) round-trips | Array of content blocks |
| SC36 | Content | empty result (undefined) round-trips | Empty content array |
| SC37 | Content | large output (100KB) round-trips | No truncation |
| **Error handling** | | | |
| SC38 | Error | sync throw → isError: true | Error message in content |
| SC39 | Error | async throw → isError: true | Error message in content |
| SC40 | Error | unknown tool → JSON-RPC -32602 | Error response |
| SC41 | Error | method not found → JSON-RPC -32601 | Error response |
| SC42 | Error | invalid JSON body → 400 | Parse error |
| **Dynamic tools** | | | |
| SC43 | Dynamic | tool added after init appears in list | `tools/list` reflects addition |
| SC44 | Dynamic | tool removed after init disappears from list | `tools/list` reflects removal |
| SC45 | Dynamic | `notifyToolsChanged` delivered to client | Client callback fires |
| **Batch requests** | | | |
| SC46 | Batch | batch of 3 requests → 3 responses | All accounted for |
| SC47 | Batch | batch of mixed requests + notifications | Responses only for requests |
| **Concurrency** | | | |
| SC48 | Multi | two clients with separate sessions | Independent |
| SC49 | Multi | concurrent requests on same session | Both resolve |
| SC50 | Multi | one client DELETE doesn't affect other | Isolation |

#### Shared test runner pattern

```ts
// spec-conformance.test.ts
import { createTestMcpServer, createHttpTestPair, createHttpTestPairWithTinyClient } from "./testing.js";

function defineConformanceSuite(
  suiteName: string,
  createPair: (server: HttpServer) => Promise<TestPair>
) {
  describe(suiteName, () => {
    let server: HttpServer;
    let pair: TestPair;

    beforeEach(async () => {
      server = createTestMcpServer();
      pair = await createPair(server);
    });

    afterEach(async () => {
      await pair.cleanup();
    });

    it("SC1: client sends JSON-RPC via POST", async () => {
      const result = await pair.client.listTools();
      expect(result.tools.length).toBeGreaterThan(0);
    });

    // ... SC2-SC50 ...
  });
}

// Run same suite against both clients
defineConformanceSuite("Spec conformance (MCP SDK client)", createHttpTestPair);
defineConformanceSuite("Spec conformance (tiny-mcp-client)", createHttpTestPairWithTinyClient);
```

This means every spec conformance test runs **twice** (100 test executions total for 50 test cases), catching interop bugs between our server and each client implementation.

### 6.4 Test summary

| Area | File | Test count |
|------|------|-----------|
| Refactoring: handleMessage | `tiny-stdio-mcp-server/server.test.ts` | 10 |
| Refactoring: onNotification | `tiny-stdio-mcp-server/server.test.ts` | 7 |
| SSE formatting | `tiny-http-mcp-server/sse.test.ts` | 9 |
| Body parsing | `tiny-http-mcp-server/parse-body.test.ts` | 21 |
| Session management | `tiny-http-mcp-server/session.test.ts` | 9 |
| HTTP transport unit | `tiny-http-mcp-server/http-transport.test.ts` | 41 |
| Integration (listenHttp + stateless + concurrency + edge) | `tiny-http-mcp-server/http-server.test.ts` | 33 |
| Express middleware | `tiny-http-mcp-server/express-middleware.test.ts` | 12 |
| CLI | `tiny-http-mcp-server/cli.test.ts` | 8 |
| Spec conformance (SDK client) | `tiny-http-mcp-server/spec-conformance.test.ts` | 50 |
| Spec conformance (tiny-mcp-client) | `tiny-http-mcp-server/spec-conformance.test.ts` | 50 |
| **Total new tests** | | **250** |
| Existing tests (must pass unchanged) | `tiny-stdio-mcp-server/**/*.test.ts` | ~105 |

---

## 7. Reuse map

Summary of what comes from where:

| Capability | Source | How it's reused |
|-----------|--------|----------------|
| Tool registry + handler dispatch | `tiny-stdio-mcp-server` `createServer()` | `server.handleMessage()` called by HTTP transport |
| JSON-RPC parsing | `tiny-stdio-mcp-server` `parseMessage()` | Called by `parse-body.ts` for each message in POST body |
| JSON-RPC formatting | `tiny-stdio-mcp-server` `formatSuccessResponse()` / `formatErrorResponse()` | Called by HTTP transport to build responses |
| Schema definition | `tiny-stdio-mcp-server` `defineSchema()` | Re-exported, used identically |
| Content helpers | `tiny-stdio-mcp-server` `Image`, `Audio`, `File`, `toContentBlocks()` | Re-exported, used identically |
| Type definitions | `tiny-stdio-mcp-server` all types | Re-exported |
| Protocol negotiation | `tiny-stdio-mcp-server` `handleMessage("initialize")` | Called by HTTP transport on POST |
| Tool list changed notification | `tiny-stdio-mcp-server` `server.onNotification()` | HTTP transport subscribes to push to SSE streams |
| Test utilities | `tiny-stdio-mcp-server/testing` `createTestPair()` | Still works for stdio tests. New `createHttpTestPair()` for HTTP tests. |

**What `tiny-http-mcp-server` adds (not in base):**

| Capability | Module |
|-----------|--------|
| HTTP request routing (POST/GET/DELETE) | `http-transport.ts` |
| SSE event formatting | `sse.ts` |
| JSON-RPC body parsing from HTTP stream | `parse-body.ts` |
| Session ID generation + validation | `session.ts` |
| `http.createServer` lifecycle | `http-server.ts` |
| Express middleware adapter | `express-middleware.ts` |
| Standalone CLI binary | `cli.ts` |
| Spec conformance test harness + fixtures | `testing.ts`, `spec-conformance.test.ts` |

---

## 8. Implementation order

### Step 1 — Refactor `tiny-stdio-mcp-server` (no new package yet)

1. Add `HandleResult` to `types.ts`
2. Add `handleMessage` + `onNotification` to `Server` interface in `server.ts`
3. Implement: promote closured `handleRequest` to `server.handleMessage`, add notification listener set
4. Refactor `connect()` and `connectSDK()` to use `server.handleMessage` + `server.onNotification`
5. Add 17 new tests (R1-R17)
6. Run ALL existing tests — must pass unchanged
7. Export `HandleResult` from `index.ts`

### Step 2 — Scaffold `tiny-http-mcp-server`

1. Create `packages/tiny-http-mcp-server/` with `package.json`, `tsconfig.json`
2. Create `src/index.ts` with re-exports
3. Verify it builds

### Step 3 — Implement leaf modules

1. `sse.ts` + `sse.test.ts` (9 tests)
2. `parse-body.ts` + `parse-body.test.ts` (21 tests)
3. `session.ts` + `session.test.ts` (9 tests)

### Step 4 — Implement transport

1. `http-transport.ts` + `http-transport.test.ts` (41 tests)

### Step 5 — Implement server wrapper + standalone mode

1. `http-server.ts` (createHttpServer, listenHttp, handleRequest)
2. `testing.ts` (createTestMcpServer, createHttpTestPair, createHttpTestPairWithTinyClient)
3. `http-server.test.ts` (33 integration tests)

### Step 6 — Express middleware

1. `express-middleware.ts` (createExpressMiddleware)
2. `express-middleware.test.ts` (12 tests)

### Step 7 — CLI

1. `cli.ts` (standalone binary entry point)
2. `cli.test.ts` (8 tests)

### Step 8 — Spec conformance harness

1. Build `createTestMcpServer()` fixture with all tool types
2. Build shared test runner (`defineConformanceSuite`)
3. `spec-conformance.test.ts` — 50 tests × 2 clients = 100 executions

### Step 9 — README

1. Write README covering: install, quick start (standalone + Express), API, CLI usage, BYO server, stateless mode, testing

---

## 9. Phases

### Phase 1 (this plan) — Core HTTP transport
Everything in steps 1-6 above.

### Phase 2 (future) — Resumability
- `EventStore` interface
- SSE event IDs on all events
- `Last-Event-ID` reconnection in GET handler
- In-memory event store implementation

### Phase 3 (future) — Origin validation
- `allowedOrigins` option
- DNS rebinding protection

### Phase 4 (future) — agent-mcp-config integration
- HTTP server entries in agent configs (already typed as `McpHttpServer`)
