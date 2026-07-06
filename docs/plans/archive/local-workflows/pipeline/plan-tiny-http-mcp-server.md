---
kind: pipeline
version: 1
tasks:
  - id: refactor-stdio-types
    title: Add HandleResult type and export from tiny-stdio-mcp-server
    prompt: |
      In `packages/tiny-stdio-mcp-server`:

      1. Add `HandleResult` interface to `src/types.ts`:
         ```ts
         export interface HandleResult {
           result?: unknown;
           error?: { code: number; message: string };
         }
         ```
      2. Export `HandleResult` from `src/index.ts`.

      This is a pure additive change — no existing code changes.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: refactor-stdio-handle-message
    title: Expose handleMessage on Server interface in tiny-stdio-mcp-server
    prompt: >
      In `packages/tiny-stdio-mcp-server/src/server.ts`:


      1. Add `handleMessage(method: string, params?: Record<string, unknown>):
      Promise<HandleResult>` to the `Server` interface.

      2. Promote the existing closured `handleRequest` function to `server.handleMessage` — same
      logic, just exposed publicly.

      3. Refactor `connect()` and `connectSDK()` to call `server.handleMessage` instead of the
      closured `handleRequest`.


      All existing tests MUST pass unchanged. The behavior is identical — we're just making the
      internal function public.


      Add 10 new tests to `server.test.ts` in a `handleMessage` describe block:

      - R1: `handleMessage("ping")` returns `{ result: {} }`

      - R2: `handleMessage("initialize", {})` returns InitializeResult

      - R3: `handleMessage("tools/list")` after initialize returns tool list

      - R4: `handleMessage("tools/list")` before initialize returns error

      - R5: `handleMessage("tools/call", { name, arguments })` invokes handler

      - R6: `handleMessage("tools/call", { name: "missing" })` returns tool not found error

      - R7: `handleMessage("tools/call", {})` returns tool name required error

      - R8: `handleMessage("unknown/method")` returns METHOD_NOT_FOUND (-32601)

      - R9: `handleMessage("notifications/initialized")` returns `{ result: undefined }`

      - R10: `handleMessage` with throwing tool handler returns isError result
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: refactor-stdio-on-notification
    title: Add onNotification pub/sub to tiny-stdio-mcp-server Server
    prompt: >
      In `packages/tiny-stdio-mcp-server/src/server.ts`:


      1. Add `onNotification(listener: (notification: JSONRPCNotification) => void): () => void` to
      the `Server` interface.

      2. Replace the single-transport `sendNotification` with a listener set pattern:
         - `notificationListeners = new Set<(n: JSONRPCNotification) => void>()`
         - `broadcastNotification` iterates all listeners
         - `server.onNotification` adds/removes listeners, returns unsubscribe function
      3. Update `notifyToolsChanged` to use `broadcastNotification`.

      4. Update `connect()` and `connectSDK()` to register themselves as notification listeners and
      unsubscribe on close.


      All existing tests MUST pass unchanged.


      Add 7 new tests to `server.test.ts` in an `onNotification` describe block:

      - R11: listener receives `notifications/tools/list_changed` after `notifyToolsChanged()`

      - R12: multiple listeners all receive notification

      - R13: unsubscribe prevents further notifications

      - R14: `notifyToolsChanged()` before initialize is silent

      - R15: listener added after initialize receives future notifications

      - R16: notification has correct JSON-RPC shape `{ jsonrpc: "2.0", method:
      "notifications/tools/list_changed" }`

      - R17: unsubscribe is idempotent (calling twice doesn't throw)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: scaffold-http-package
    title: Scaffold tiny-http-mcp-server package
    prompt: >
      Create `packages/tiny-http-mcp-server/` with:


      1. `package.json` — name `tiny-http-mcp-server`, version `0.1.0`, ESM, depends on
      `tiny-stdio-mcp-server`. Express as optional peer dep. Dev deps: `@modelcontextprotocol/sdk`,
      `express`, `@types/express`. Bin entry `tiny-http-mcp-server` pointing to `dist/cli.js`.
      Exports: `.` → `dist/index.js`, `./testing` → `dist/testing.js`.

      2. `tsconfig.json` — extends root or workspace tsconfig, ESM output.

      3. `src/index.ts` — re-exports everything from `tiny-stdio-mcp-server` plus HTTP-specific
      exports (placeholder stubs for now).

      4. `README.md` — minimal placeholder.


      Verify the package builds with `tsc`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-sse
    title: Implement SSE event formatting module
    prompt: >
      In `packages/tiny-http-mcp-server/src/`:


      Create `sse.ts`:

      - `formatSseEvent(event: SseEvent): string` — formats `{ data, id?, event? }` into SSE wire
      format ending with `\n\n`

      - `SSE_HEADERS` constant — `{ "Content-Type": "text/event-stream", "Cache-Control":
      "no-cache", "Connection": "keep-alive" }`

      - `SseEvent` interface


      Create `sse.test.ts` with 9 tests (S1-S9):

      - S1: formats basic SSE event with data only

      - S2: formats event with id field

      - S3: formats event with event type

      - S4: formats event with all fields (id, event, data in correct order)

      - S5: handles empty data string

      - S6: handles data with special characters (JSON with quotes, unicode, emoji)

      - S7: SSE_HEADERS contains correct content-type `text/event-stream`

      - S8: SSE_HEADERS contains cache-control `no-cache`

      - S9: SSE_HEADERS contains connection `keep-alive`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-parse-body
    title: Implement JSON-RPC body parsing and classification
    prompt: >
      In `packages/tiny-http-mcp-server/src/`:


      Create `parse-body.ts`:

      - `readAndClassifyBody(req: IncomingMessage, preParsed?: unknown): Promise<ClassifiedBody>`

      - Reads body from stream (or uses `req.body` / `preParsed` if available)

      - Parses JSON, validates each message using `parseMessage()` from
      `tiny-stdio-mcp-server/jsonrpc`

      - Classifies into requests, notifications, responses

      - `ClassifiedBody` interface with `messages`, `hasRequests`, `hasNotifications`,
      `hasResponses`, `requests`, `notifications`, `responses`


      Create `parse-body.test.ts` with 21 tests (P1-P21):

      - P1-P3: parses single request / notification / response

      - P4-P6: parses batch of requests / notifications / responses

      - P7: parses mixed batch (requests + notifications)

      - P8-P10: classifies requests-only / notifications-only / responses-only

      - P11-P14: rejects invalid JSON, non-object body (number, string, null)

      - P15: rejects message missing jsonrpc field

      - P16: rejects empty array

      - P17-P18: accepts pre-parsed body object / array

      - P19: request identified by method + id

      - P20: notification identified by method + no id

      - P21: response identified by result/error + id + no method
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-session
    title: Implement session management module
    prompt: |
      In `packages/tiny-http-mcp-server/src/`:

      Create `session.ts`:
      - `createSessionStore(): SessionStore` — in-memory Map-based session store
      - `defaultSessionIdGenerator(): string` — `crypto.randomUUID()`
      - `Session` interface: `{ id, initialized, createdAt }`
      - `SessionStore` interface: `{ create, get, delete, has }`

      Create `session.test.ts` with 9 tests (SS1-SS9):
      - SS1: `defaultSessionIdGenerator()` returns non-empty string
      - SS2: session IDs are unique (100 generated → all different)
      - SS3: session ID is visible ASCII (0x21-0x7E)
      - SS4: `create(id)` stores session, `has(id)` returns true
      - SS5: `get(id)` returns session with id, initialized, createdAt
      - SS6: `get(unknownId)` returns undefined
      - SS7: `delete(id)` removes session
      - SS8: `delete(unknownId)` returns false
      - SS9: `has(unknownId)` returns false
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-http-transport
    title: Implement StreamableHttpTransport core
    prompt: >
      In `packages/tiny-http-mcp-server/src/`:


      Create `http-transport.ts`:

      - `StreamableHttpTransport` class that takes a `Server` (from tiny-stdio-mcp-server) and
      options

      - `handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>` — routes
      POST/GET/DELETE, returns 405 for others

      - POST: uses `readAndClassifyBody` to parse, calls `server.handleMessage` for each request,
      formats responses as JSON or SSE

      - POST notifications-only/responses-only → 202

      - GET: opens SSE stream, subscribes to `server.onNotification`, pushes events

      - DELETE: terminates session, closes SSE streams

      - Session validation: `Mcp-Session-Id` header on init response, validates on subsequent
      requests (400 missing, 404 invalid)

      - Stateless mode (`sessionIdGenerator: undefined`): no session headers, GET/DELETE → 405

      - `close(): Promise<void>` — closes all SSE connections, unsubscribes from notifications


      Uses: `sse.ts` for SSE formatting, `parse-body.ts` for body parsing, `session.ts` for session
      management, `server.handleMessage` for request dispatch, `server.onNotification` for
      notifications, `formatSuccessResponse`/`formatErrorResponse` from tiny-stdio-mcp-server for
      JSON-RPC response formatting.


      Create `http-transport.test.ts` with 41 tests (T1-T41) covering:

      - POST basic request/response (T1-T5)

      - POST content-type negotiation (T6-T9)

      - POST batch (T10-T13)

      - POST session validation (T14-T17)

      - POST errors (T18-T24)

      - POST headers (T25-T27)

      - GET SSE stream (T28-T33)

      - DELETE session termination (T34-T38)

      - Unsupported methods (T39-T41)


      See plan doc section 4.4 and 6.2 for full details.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-http-server
    title: Implement createHttpServer wrapper and test helpers
    prompt: |
      In `packages/tiny-http-mcp-server/src/`:

      Create `http-server.ts`:
      - `createHttpServer(options: ServerOptions & HttpTransportOptions): HttpServer`
      - Wraps `createServer()` from tiny-stdio-mcp-server, creates `StreamableHttpTransport`, extends server with:
        - `listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>` — starts Node.js `http.createServer`, returns handle with url/port/close
        - `handleRequest` — delegates to transport
      - `HttpServer` extends `Server`
      - Types: `HttpTransportOptions`, `HttpListenOptions`, `HttpServerHandle`

      Create `testing.ts` (exported from `./testing` subpath):
      - `createTestMcpServer(options?)` — factory building server with echo/reverse/uppercase/get_user/get_list/get_image/get_audio/get_file/get_mixed/throw_sync/throw_async/empty_result/slow/large_output tools
      - `createHttpTestPair(server)` — SDK client test pair using `StreamableHTTPClientTransport`
      - `createHttpTestPairWithTinyClient(server)` — tiny-mcp-client test pair (if available, otherwise skip)

      Create `http-server.test.ts` with 33 integration tests covering:
      - SDK client integration (I1-I8)
      - tiny-mcp-client integration (I9-I13, skip if not available)
      - listenHttp convenience (I14-I21)
      - Stateless mode (I22-I25)
      - Multiple clients / concurrency (I26-I28)
      - Edge cases (I29-I33)

      See plan doc sections 4.5, 4.8, and 6.2 for full details.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-express-middleware
    title: Implement Express middleware adapter
    prompt: >
      In `packages/tiny-http-mcp-server/src/`:


      Create `express-middleware.ts`:

      - `createExpressMiddleware(server: HttpServer): RequestHandler`

      - Thin adapter: calls `server.handleRequest(req, res)`, catches errors and passes to
      `next(err)`

      - Express is an optional peer dep — import types only


      Create `express-middleware.test.ts` with 12 tests (E1-E12):

      - E1: SDK client initializes and lists tools via Express

      - E2: SDK client calls tool via Express

      - E3: POST on mounted path works

      - E4: non-MCP routes still work (`/health` returns 200)

      - E5: GET SSE stream works via Express

      - E6: DELETE session works via Express

      - E7: auth middleware before MCP (401 without token, 200 with)

      - E8: error propagates to Express error handler via `next(err)`

      - E9: works with `express.json()` body parser (pre-parsed body)

      - E10: works at nested path `/api/v1/mcp`

      - E11: multiple MCP servers on different paths

      - E12: stateless mode works via Express


      Tests spin up real Express apps with `createExpressMiddleware`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-cli
    title: Implement standalone CLI entry point
    prompt: >
      In `packages/tiny-http-mcp-server/src/`:


      Create `cli.ts`:

      - `#!/usr/bin/env node`

      - Parses args: `--port`, `--hostname`, `--path`, `--stateless`, `--json-response`,
      `-h`/`--help`

      - Uses Node.js built-in `util.parseArgs` (no commander needed for this simple CLI)

      - Creates server via `createHttpServer`, calls `listenHttp`, logs URL

      - Graceful shutdown on SIGINT/SIGTERM


      Create `cli.test.ts` with 8 tests (C1-C8):

      - C1: starts server on default port 3000

      - C2: `--port 0` picks random port

      - C3: `--hostname 127.0.0.1` binds correctly

      - C4: `--path /api/mcp` uses custom path

      - C5: `--stateless` disables sessions

      - C6: `--json-response` returns JSON content-type

      - C7: `-h`/`--help` shows help and exits with code 0

      - C8: SIGINT triggers graceful shutdown
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: implement-spec-conformance
    title: Implement spec conformance test harness
    prompt: |
      In `packages/tiny-http-mcp-server/src/`:

      Create `spec-conformance.test.ts`:
      - Uses `createTestMcpServer()` from `testing.ts`
      - Uses `defineConformanceSuite(suiteName, createPair)` shared pattern
      - Runs 50 test cases (SC1-SC50) × 2 clients (SDK + tiny-mcp-client) = 100 executions
      - Tests cover all MCP Streamable HTTP spec sections:
        - Sending Messages (POST): SC1-SC13
        - Listening (GET): SC14-SC19
        - Session Management: SC20-SC27
        - Unsupported methods: SC28-SC29
        - Tool content types: SC30-SC37
        - Error handling: SC38-SC42
        - Dynamic tools: SC43-SC45
        - Batch requests: SC46-SC47
        - Concurrency: SC48-SC50

      See plan doc section 6.3 for the full test matrix and shared runner pattern.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: write-readme
    title: Write README for tiny-http-mcp-server
    prompt: |
      Create `packages/tiny-http-mcp-server/README.md` covering:
      - Package description (Streamable HTTP transport for tiny MCP servers)
      - Install instructions
      - Quick start: standalone server (programmatic + CLI)
      - Quick start: Express middleware mount
      - BYO HTTP server (raw Node.js)
      - Stateless mode
      - API reference: `createHttpServer`, `createExpressMiddleware`, types
      - CLI usage and flags
      - Testing helpers (`createHttpTestPair`, `createTestMcpServer`)
      - Environment variables (if any)
      - Config options via options objects
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: update-index-exports
    title: Finalize index.ts exports and verify full build
    prompt: >
      In `packages/tiny-http-mcp-server/src/index.ts`:


      Finalize all exports:

      - Re-exports from `tiny-stdio-mcp-server` (createServer, defineSchema, Image, Audio, File,
      toContentBlocks, fileTypeFromBuffer, JSON_RPC_ERROR_CODES, all types)

      - HTTP-specific exports: `createHttpServer`, `createExpressMiddleware`

      - HTTP types: `HttpServer`, `HttpTransportOptions`, `HttpListenOptions`, `HttpServerHandle`


      Run full build of both packages. Run all tests across both `tiny-stdio-mcp-server` and
      `tiny-http-mcp-server`. Ensure everything passes.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# tiny http mcp server

Archived local pipeline plan converted from YAML during docs cleanup.
