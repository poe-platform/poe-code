# Plan: `tiny-http-mcp-server`

Add HTTP (Streamable HTTP) transport to the MCP stack. Re-architect `tiny-stdio-mcp-server` to cleanly separate protocol logic from transport, then build `tiny-http-mcp-server` on top.

> **Fix for stdio state loss**: When Claude Code reconnects (plan mode exit, interruption), the stdio process restarts and all in-memory PTY sessions are lost. The HTTP server is a long-running process that survives reconnections. Items marked **[needed]** are the minimal set to implement this fix. Items marked **[defer]** are cleanup/extras that can wait.

---

## Phase 1 — Re-architect `tiny-stdio-mcp-server` **[needed, except `transport/stdio.ts`]**

### New file layout

```text
packages/tiny-stdio-mcp-server/src/
  session.ts        ← NEW: pure protocol handler (no I/O)          [needed]
  server.ts         ← CHANGED: tool registry + session factory      [needed]
  transport/
    stdio.ts        ← NEW: extracted stdio wiring                   [defer]
  jsonrpc.ts        ← unchanged
  schema.ts         ← unchanged
  types.ts          ← updated interfaces                            [needed]
  content/          ← unchanged
  testing.ts        ← updated                                       [needed]
  index.ts          ← updated exports                               [needed]
```

### `session.ts` — pure protocol, no I/O **[needed]**

```ts
export interface Session {
  handleRequest(
    method: string,
    params?: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  onNotification(handler: (method: string) => void): void;
  notify(method: string): void;
  close(): void;
}

export function createSession(options: ServerOptions, tools: ReadonlyMap<string, ToolDefinition>): Session
```

- Owns `initialized` boolean
- Reads tools from the shared Map reference (live — sees additions immediately)
- `handleRequest` is pure: no writing, no streams, just returns `{result?, error?}`
- `onNotification` registers the transport's push function (called by `notify`)
- `close()` unregisters the notification handler

### `server.ts` — tool registry + session factory **[needed]**

```ts
export interface Server {
  tool<T>(name: string, description: string, inputSchema: TypedSchema<T>, handler: ToolHandler<T>): Server;
  removeTool(name: string): boolean;
  createSession(): Session;
  notifyToolsChanged(): void;
  // stdio convenience (unchanged public API)
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
}
```

- `tools` is a `Map<string, ToolDefinition>` — shared reference passed to every session
- `createSession()` creates a `Session`, tracks it in a `Set<Session>`, removes on `close()`
- `notifyToolsChanged()` calls `session.notify("notifications/tools/list_changed")` on all live sessions
- `listen/connect/connectSDK` call `createSession()` internally + wire to stdio transport

### `transport/stdio.ts` **[defer]**

Extracted from current `server.ts` — no logic changes, just moved. Not required for the HTTP fix; `connect`/`connectSDK` can stay inline in `server.ts` for now.

```ts
export function connectSessionToStdio(session: Session, transport: Transport): Promise<void>
export function connectSessionToSDK(session: Session, transport: SDKTransport): Promise<void>
```

---

## Phase 2 — New package: `tiny-http-mcp-server` **[needed]**

### Package structure

```text
packages/tiny-http-mcp-server/
  src/
    index.ts          # exports mountMcpHandler + types
    http-handler.ts   # Express routes, session map, SSE
  package.json        # deps: express, tiny-stdio-mcp-server
  README.md
  tsconfig.json
```

### API

```ts
export interface MountOptions {
  path?: string;          // default: "/mcp"
  sessionTimeout?: number; // ms, default: 30 min
  auth?: RequestHandler;  // Express middleware run before MCP logic
}

export function mountMcpHandler(
  app: Express,
  server: Server,
  options?: MountOptions
): void
```

### Session lifecycle

```text
POST /mcp (no Mcp-Session-Id)  → server.createSession(), generate id, return Mcp-Session-Id header
POST /mcp (with Mcp-Session-Id) → look up session, call session.handleRequest()
GET  /mcp (with Mcp-Session-Id) → SSE stream, call session.onNotification(pushSSE)
DELETE /mcp                     → session.close(), 204
```

Single-message POST response: `Content-Type: application/json`  
If server pushes notifications: response upgrades to `Content-Type: text/event-stream`

### OAuth / auth

No built-in provider. Pass Express middleware as `auth`:

```ts
mountMcpHandler(app, server, {
  auth: (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${process.env.MCP_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }
});
```

---

## Testing

Three layers, each building on the previous. All unit tests use `session.handleRequest()` directly — no transports, no HTTP.

### Layer 1 — Session protocol (`tiny-stdio-mcp-server`) **[needed]**

**Initialization**

- `ping` before `initialize` → `{}`
- `initialize` → returns `protocolVersion`, `capabilities.tools.listChanged: true`, `serverInfo`
- any method before `initialize` → `{ error: { code: INVALID_REQUEST, message: "Server not initialized" } }`
- `notifications/initialized` → no response (notification, not a request)
- `initialize` called twice → second call still returns valid result

**tools/list**

- no tools registered → `{ tools: [] }`
- tools registered → returns each with correct `name`, `description`, `inputSchema`
- tool added after session created → appears in next `tools/list` (shared Map reference)
- tool removed via `server.removeTool()` → absent from next `tools/list`

**tools/call**

- call existing tool with valid args → `{ content: [...], isError: undefined }`
- tool returns string → `[{ type: "text", text: "..." }]`
- tool returns object → `[{ type: "text", text: JSON.stringify(...) }]`
- tool returns `Image(...)` → `[{ type: "image", ... }]`
- tool returns `undefined` / `void` → `{ content: [] }`
- tool throws → `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`
- call with missing `name` param → `{ error: { code: INVALID_PARAMS, message: "Tool name required" } }`
- call unknown tool name → `{ error: { code: INVALID_PARAMS, message: "Tool not found: ..." } }`

**Unknown method**

- any unrecognised method → `{ error: { code: METHOD_NOT_FOUND, message: "Method not found" } }`

**Notifications**

- `session.onNotification(cb)` registered, then `session.notify("foo")` → `cb` called with `"foo"`
- `session.onNotification` not registered, `session.notify(...)` → no-op, no throw
- `session.close()` then `session.notify(...)` → no-op (handler unregistered)

### Layer 2 — Server (`tiny-stdio-mcp-server`) **[needed]**

**Tool registry**

- `server.tool(name, ...)` → tool present in sessions created before AND after registration
- `server.removeTool(name)` → returns `true`; subsequent sessions don't see the tool
- `server.removeTool("nonexistent")` → returns `false`

**Session tracking**

- `server.createSession()` → returns a new `Session`
- two sessions from same server share the same tools Map
- `server.notifyToolsChanged()` with 2 live sessions → both sessions' notification handlers called
- `server.notifyToolsChanged()` after one session closed → only the live session notified
- `server.notifyToolsChanged()` with no sessions → no-op

### Layer 3 — stdio transport (`tiny-stdio-mcp-server`) **[defer]**

Only needed once `transport/stdio.ts` is extracted. Tests use in-memory streams (no real stdin/stdout).

**connectSessionToStdio**

- valid JSON-RPC request line → correct response written to writable
- malformed JSON → error response written (`PARSE_ERROR`)
- notification line (no `id`) → nothing written to writable
- readable closes → returned promise resolves

**connectSessionToSDK**

- request message → response sent via `transport.send`
- notification message (no `id`) → `handleRequest` called, nothing sent
- `transport.onclose()` fires → returned promise resolves

### Layer 4 — HTTP handler (`tiny-http-mcp-server`) **[needed]**

Uses a real Express app with `supertest`. No MCP SDK client — raw HTTP assertions.

**New session (POST without `Mcp-Session-Id`)**

- `POST /mcp` with `initialize` body → 200, `Mcp-Session-Id` header present in response
- same `Mcp-Session-Id` on follow-up `POST /mcp` → routes to existing session

**Existing session (POST with `Mcp-Session-Id`)**

- known session, `tools/list` → 200 JSON with tools
- known session, `tools/call` → 200 JSON with result
- unknown `Mcp-Session-Id` → 404

**Bad requests**

- non-JSON body → 400
- missing `Content-Type: application/json` → 400
- `POST /mcp` body is valid JSON but not JSON-RPC → JSON-RPC parse error in 200 response

**DELETE /mcp**

- known session → 204, session removed
- unknown session → 404
- subsequent POST with same session id after DELETE → 404

**GET /mcp (SSE)**

- known session → 200 `Content-Type: text/event-stream`, connection held open
- unknown session → 404
- `server.notifyToolsChanged()` while SSE client connected → event data arrives
- SSE client disconnects → `session.onNotification` handler cleaned up (no leak)

**Auth middleware**

- no `auth` option → all requests pass through
- `auth` calls `next()` → request processed normally
- `auth` calls `res.status(401).json(...)` → 401 returned, session not created/accessed

**Session timeout**

- session inactive beyond `sessionTimeout` → removed from map; subsequent POST returns 404

**Concurrent sessions**

- two clients simultaneously, each with own session id → tool calls independent
- `server.notifyToolsChanged()` with two SSE clients open → both receive the event

### Layer 5 — MCP SDK integration (`@modelcontextprotocol/sdk`) **[defer]**

Full protocol round-trip using the SDK client. These catch any drift between the custom JSON-RPC implementation and the official SDK expectations. We do not depend on the SDK directly — defer until needed.

**InMemoryTransport (no HTTP)**

```ts
// Pattern — not for implementation
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const session = server.createSession();
connectSessionToSDK(session, serverTransport);
const client = new Client({ name: "test", version: "0.0.0" });
await client.connect(clientTransport);
```

Scenarios:

- `client.listTools()` → matches registered tools
- `client.callTool("echo", { msg: "hi" })` → correct content returned
- `server.notifyToolsChanged()` → client receives `tools/list_changed` notification

**StreamableHttpClientTransport (full HTTP)**

```ts
// Pattern — not for implementation
const app = express();
mountMcpHandler(app, server);
const httpServer = app.listen(0);
const { port } = httpServer.address() as AddressInfo;
const client = new Client({ name: "test", version: "0.0.0" });
await client.connect(new StreamableHttpClientTransport(new URL(`http://localhost:${port}/mcp`)));
```

Scenarios:

- `client.listTools()` → correct tools over HTTP
- `client.callTool(...)` → correct result over HTTP
- two simultaneous clients → independent sessions, no state bleed
- `server.notifyToolsChanged()` → both clients receive notification via SSE

---

## Usage examples

> These are illustrative — **not for implementation**.

### Mounting in an Express app

```ts
// example only — not for implementation
import express from "express";
import { createServer } from "tiny-stdio-mcp-server";
import { mountMcpHandler } from "tiny-http-mcp-server";

const server = createServer({ name: "my-server", version: "1.0.0" });
server.tool("echo", "Return input unchanged",
  defineSchema({ message: { type: "string" } }),
  ({ message }) => message
);

const app = express();
mountMcpHandler(app, server); // mounts POST /mcp, GET /mcp, DELETE /mcp
app.listen(3000);
```

### Same server, both transports

One `Server` instance can be exposed over stdio and HTTP simultaneously — tools registered once, accessible from both:

```ts
// example only — not for implementation
const server = createServer({ name: "my-server", version: "0.0.0" });
server.tool("echo", ...);

mountMcpHandler(app, server, { path: "/mcp" }); // HTTP clients
server.listen();                                  // stdio client (e.g. Claude Desktop)
```

### Stateful tools across multiple sessions

Tool handlers share server-level state. Per-session state is scoped via tool args:

```ts
// example only — not for implementation
const sessions = new Map<string, { count: number }>();

server.tool("increment", "Increment per-session counter",
  defineSchema({ sessionId: { type: "string" } }),
  ({ sessionId }) => {
    const s = sessions.get(sessionId) ?? { count: 0 };
    s.count++;
    sessions.set(sessionId, s);
    return { count: s.count };
  }
);
```

### With auth middleware

```ts
// example only — not for implementation
mountMcpHandler(app, server, {
  auth: (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${process.env.MCP_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }
});
```

### Tool hot-reload (`notifyToolsChanged`)

```ts
// example only — not for implementation
server.removeTool("old_tool");
server.tool("new_tool", "...", schema, handler);
server.notifyToolsChanged();
// all SSE-connected clients receive notifications/tools/list_changed
```

---

## Files changed

| Package                   | File                     | Action                            | Scope    |
|---------------------------|--------------------------|-----------------------------------|----------|
| `tiny-stdio-mcp-server`   | `src/session.ts`         | New                               | needed   |
| `tiny-stdio-mcp-server`   | `src/server.ts`          | Refactor                          | needed   |
| `tiny-stdio-mcp-server`   | `src/types.ts`           | Add `Session` interface           | needed   |
| `tiny-stdio-mcp-server`   | `src/index.ts`           | Export `Session`, `createSession` | needed   |
| `tiny-stdio-mcp-server`   | `src/testing.ts`         | Use `createSession` internally    | needed   |
| `tiny-stdio-mcp-server`   | `src/transport/stdio.ts` | New (extracted)                   | defer    |
| `tiny-http-mcp-server`    | all                      | New package                       | needed   |
| `terminal-pilot-mcp`      | `src/mcp-server.ts`      | Add HTTP mode                     | needed   |
| `terminal-pilot-mcp`      | `src/cli.ts`             | Add `--port` flag                 | needed   |
| `.mcp.json`               | —                        | Switch to `type: "http"`          | needed   |
