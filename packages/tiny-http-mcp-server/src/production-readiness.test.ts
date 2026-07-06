import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { defineSchema } from "tiny-stdio-mcp-server";
import {
  createExpressOAuthHandlers,
  createHttpServer,
  createJwksTokenVerifier,
  type HttpObservabilityEvent,
  type Session,
  type SessionStore
} from "./index.js";
import { createBearerChallenge } from "./auth.js";

const TEST_PROTOCOL_VERSION = "2025-03-26";

async function initializeSession(server: ReturnType<typeof createHttpServer>): Promise<string> {
  const response = await postJsonRpc(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: TEST_PROTOCOL_VERSION }
  });
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await postJsonRpc(
    server,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { sessionId: sessionId ?? undefined }
  );
  return sessionId ?? "";
}

async function postJsonRpc(
  server: ReturnType<typeof createHttpServer>,
  message: unknown,
  options: {
    sessionId?: string;
    headers?: HeadersInit;
  } = {}
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...options.headers
  });

  if (options.sessionId !== undefined) {
    headers.set("Mcp-Session-Id", options.sessionId);
    headers.set("MCP-Protocol-Version", TEST_PROTOCOL_VERSION);
  }

  return dispatch(server, {
    method: "POST",
    headers,
    body: typeof message === "string" ? message : JSON.stringify(message)
  });
}

async function dispatch(
  server: ReturnType<typeof createHttpServer>,
  options: {
    method: string;
    headers?: HeadersInit;
    body?: string;
    url?: string;
  }
): Promise<Response> {
  const { response } = await dispatchRaw(server, options);

  return new Response(response.statusCode === 204 ? null : Buffer.concat(response.chunks), {
    status: response.statusCode,
    headers: response.headerValues
  });
}

async function dispatchRaw(
  server: ReturnType<typeof createHttpServer>,
  options: {
    method: string;
    headers?: HeadersInit;
    body?: string;
    url?: string;
  }
): Promise<{
  response: ServerResponse & {
    chunks: Uint8Array[];
    headerValues: Headers;
    headersSent: boolean;
    writableEnded: boolean;
  };
}> {
  const headers = new Headers(options.headers);
  if (!headers.has("host")) {
    headers.set("host", "127.0.0.1");
  }

  const request = Object.assign(Readable.from(options.body === undefined ? [] : [options.body]), {
    method: options.method,
    url: options.url ?? "/mcp",
    headers: Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value])
    ),
    socket: {}
  }) as IncomingMessage;

  const response = new EventEmitter() as ServerResponse & {
    chunks: Uint8Array[];
    headerValues: Headers;
    headersSent: boolean;
    writableEnded: boolean;
  };
  response.statusCode = 200;
  response.chunks = [];
  response.headerValues = new Headers();
  response.headersSent = false;
  response.writableEnded = false;
  response.writeHead = ((statusCode: number, responseHeaders?: Record<string, string>) => {
    response.statusCode = statusCode;
    response.headersSent = true;
    for (const [key, value] of Object.entries(responseHeaders ?? {})) {
      response.headerValues.set(key, value);
    }
    return response;
  }) as ServerResponse["writeHead"];
  response.write = ((chunk: string | Uint8Array) => {
    response.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return true;
  }) as ServerResponse["write"];
  response.end = ((chunk?: string | Uint8Array) => {
    if (chunk !== undefined) {
      response.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    response.writableEnded = true;
    response.emit("finish");
    response.emit("close");
    return response;
  }) as ServerResponse["end"];
  response.flushHeaders = (() => {
    response.headersSent = true;
  }) as ServerResponse["flushHeaders"];

  await server.handleRequest(request, response);

  return { response };
}

async function readSseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  expect(data).toBeTruthy();
  return JSON.parse(data ?? "{}") as Record<string, unknown>;
}

describe("HTTP MCP production readiness", () => {
  it("enforces request body and batch limits before dispatching messages", async () => {
    const bodyLimitedServer = createHttpServer({
      name: "limits",
      version: "1.0.0",
      maxRequestBytes: 80
    });
    const oversized = await postJsonRpc(bodyLimitedServer, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: TEST_PROTOCOL_VERSION,
        padding: "x".repeat(80)
      }
    });
    expect(oversized.status).toBe(413);

    const batchLimitedServer = createHttpServer({
      name: "limits",
      version: "1.0.0",
      maxBatchSize: 1
    });
    const batchLimited = await postJsonRpc(
      batchLimitedServer,
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: TEST_PROTOCOL_VERSION }
        },
        { jsonrpc: "2.0", id: 2, method: "ping" }
      ],
      { headers: { "Content-Length": "1" } }
    );
    expect(batchLimited.status).toBe(400);
    const payload = await batchLimited.json();
    expect(payload).toMatchObject({
      error: {
        message: "Batch size exceeds configured limit"
      }
    });
  });

  it("uses the configured session store and expires inactive sessions", async () => {
    vi.useFakeTimers();
    const created: string[] = [];
    const deleted: string[] = [];
    const backing = new Map<string, Session>();
    const sessionStore: SessionStore = {
      create(id) {
        const session = {
          id,
          initialized: false,
          createdAt: new Date(),
          lastSeenAt: new Date()
        };
        created.push(id);
        backing.set(id, session);
        return session;
      },
      get(id) {
        return backing.get(id);
      },
      delete(id) {
        deleted.push(id);
        return backing.delete(id);
      },
      has(id) {
        return backing.has(id);
      },
      touch(id) {
        const session = backing.get(id);
        if (session !== undefined) {
          session.lastSeenAt = new Date();
        }
      },
      entries() {
        return backing.values();
      }
    };
    const server = createHttpServer({
      name: "session-store",
      version: "1.0.0",
      sessionIdGenerator: () => "session-a",
      sessionStore,
      sessionTtlMs: 1_000
    });
    try {
      const sessionId = await initializeSession(server);
      expect(sessionId).toBe("session-a");
      expect(created).toEqual(["session-a"]);

      vi.advanceTimersByTime(1_001);

      const response = await postJsonRpc(
        server,
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { sessionId }
      );

      expect(response.status).toBe(404);
      expect(deleted).toContain("session-a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconstructs local protocol state for sessions loaded from a custom store", async () => {
    const backing = new Map<string, Session>([
      [
        "external-session",
        {
          id: "external-session",
          initialized: true,
          protocolVersion: TEST_PROTOCOL_VERSION,
          createdAt: new Date(),
          lastSeenAt: new Date()
        }
      ]
    ]);
    const sessionStore: SessionStore = {
      create(id) {
        const session = {
          id,
          initialized: false,
          createdAt: new Date(),
          lastSeenAt: new Date()
        };
        backing.set(id, session);
        return session;
      },
      get(id) {
        return backing.get(id);
      },
      delete(id) {
        return backing.delete(id);
      },
      has(id) {
        return backing.has(id);
      },
      entries() {
        return backing.values();
      }
    };
    const server = createHttpServer({
      name: "external-store",
      version: "1.0.0",
      enableJsonResponse: true,
      sessionStore
    }).tool("echo", "Echo", defineSchema({}), () => "ok");

    const response = await postJsonRpc(
      server,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { sessionId: "external-session" }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      result: {
        tools: [expect.objectContaining({ name: "echo" })]
      }
    });
  });

  it("handles CORS preflight and adds hardening/request-id headers", async () => {
    const server = createHttpServer({
      name: "cors",
      version: "1.0.0",
      allowedOrigins: ["https://client.example.com"],
      allowedHosts: ["127.0.0.1"],
      requestIdGenerator: () => "req-1"
    });
    const preflight = await dispatch(server, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,mcp-session-id"
      }
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
    expect(preflight.headers.get("access-control-expose-headers")).toBe(
      "Mcp-Session-Id, X-Request-Id"
    );
    expect(preflight.headers.get("vary")).toContain("Origin");

    const response = await postJsonRpc(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();

    const crossOriginInitialize = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers: { Origin: "https://client.example.com" } }
    );

    expect(crossOriginInitialize.headers.get("access-control-allow-origin")).toBe(
      "https://client.example.com"
    );
    expect(crossOriginInitialize.headers.get("access-control-expose-headers")).toBe(
      "Mcp-Session-Id, X-Request-Id"
    );
    expect(crossOriginInitialize.headers.get("mcp-session-id")).toBeTruthy();

    const rejectedOrigin = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers: { Origin: "https://attacker.example.com" } }
    );

    expect(rejectedOrigin.status).toBe(403);
    expect(rejectedOrigin.headers.get("vary")).toContain("Origin");
    expect(rejectedOrigin.headers.get("access-control-allow-origin")).toBeNull();
    expect(rejectedOrigin.headers.get("access-control-expose-headers")).toBeNull();

    const rejectedHost = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers: { Host: "attacker.example.com" } }
    );
    expect(rejectedHost.status).toBe(403);
    expect(rejectedHost.headers.get("vary")).toContain("Origin");
  });

  it("emits observability events for requests, sessions, and tool latency", async () => {
    const events: HttpObservabilityEvent[] = [];
    const server = createHttpServer({
      name: "observed",
      version: "1.0.0",
      enableJsonResponse: true,
      sessionIdGenerator: () => "observed-session",
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    }).tool("echo", "Echo", defineSchema({ text: { type: "string" } }), ({ text }) => String(text));
    const sessionId = await initializeSession(server);
    const response = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } }
      },
      { sessionId }
    );
    expect(response.status).toBe(200);

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "request.start",
        "request.end",
        "session.created",
        "tool.start",
        "tool.end"
      ])
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.end",
        sessionId: "observed-session",
        toolName: "echo",
        ok: true,
        durationMs: expect.any(Number)
      })
    );
  });

  it("marks tool observability failures when the MCP tool result is an error", async () => {
    const events: HttpObservabilityEvent[] = [];
    const server = createHttpServer({
      name: "observed-failure",
      version: "1.0.0",
      enableJsonResponse: true,
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    }).tool("fail", "Fail", defineSchema({}), () => {
      throw new Error("boom");
    });
    const sessionId = await initializeSession(server);

    const response = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "fail", arguments: {} }
      },
      { sessionId }
    );

    expect(response.status).toBe(200);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.end",
        toolName: "fail",
        ok: false
      })
    );
  });

  it("rejects tool calls above the configured concurrency limit", async () => {
    const server = createHttpServer({
      name: "tool-limit",
      version: "1.0.0",
      maxConcurrentToolCalls: 1
    }).tool("slow", "Slow", defineSchema({}), async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "done";
    });
    const sessionId = await initializeSession(server);
    const first = postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "slow", arguments: {} }
      },
      { sessionId }
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const rejected = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "slow", arguments: {} }
      },
      { sessionId }
    );

    const payload = await readSseJson(rejected);
    expect(payload).toMatchObject({
      id: 3,
      error: {
        code: -32000,
        message: "Too many concurrent tool calls"
      }
    });
    await first;
  });

  it("releases the concurrency slot and emits a failed tool end after timeout", async () => {
    const events: HttpObservabilityEvent[] = [];
    let callCount = 0;
    const server = createHttpServer({
      name: "tool-timeout",
      version: "1.0.0",
      enableJsonResponse: true,
      maxConcurrentToolCalls: 1,
      toolCallTimeoutMs: 5,
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    }).tool("sometimes-hangs", "Sometimes hangs", defineSchema({}), () => {
      callCount += 1;
      return callCount === 1 ? new Promise(() => {}) : "done";
    });
    const sessionId = await initializeSession(server);

    const timedOut = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "sometimes-hangs", arguments: {} }
      },
      { sessionId }
    );
    const succeeded = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "sometimes-hangs", arguments: {} }
      },
      { sessionId }
    );

    await expect(timedOut.json()).resolves.toMatchObject({
      id: 2,
      error: {
        code: -32603,
        message: "Tool call timed out: sometimes-hangs"
      }
    });
    await expect(succeeded.json()).resolves.toMatchObject({
      id: 3,
      result: {
        content: [{ type: "text", text: "done" }]
      }
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.end",
        toolName: "sometimes-hangs",
        ok: false
      })
    );
  });

  it("replays stored SSE notifications after Last-Event-ID reconnects", async () => {
    const server = createHttpServer({
      name: "resume",
      version: "1.0.0",
      sessionIdGenerator: () => "resume-session"
    });
    const sessionId = await initializeSession(server);

    await server.notifyToolsChanged();

    const { response } = await dispatchRaw(server, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": TEST_PROTOCOL_VERSION,
        "Last-Event-ID": "0"
      }
    });
    const text = Buffer.concat(response.chunks).toString("utf8");

    expect(response.statusCode).toBe(200);
    expect(text).toContain("id: 1");
    expect(text).toContain("notifications/tools/list_changed");
  });

  it("rejects a second stream by default", async () => {
    const server = createHttpServer({
      name: "single-stream-default",
      version: "1.0.0",
      sessionIdGenerator: () => "single-stream-default-session"
    });
    const sessionId = await initializeSession(server);
    const streamHeaders = {
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
    };

    const first = await dispatchRaw(server, {
      method: "GET",
      headers: streamHeaders
    });
    const second = await dispatch(server, {
      method: "GET",
      headers: streamHeaders
    });

    expect(first.response.statusCode).toBe(200);
    expect(second.status).toBe(409);
  });

  it("delivers notifications only to the most recently opened stream", async () => {
    const server = createHttpServer({
      name: "multi-stream",
      version: "1.0.0",
      sessionIdGenerator: () => "multi-stream-session",
      maxStreamsPerSession: 2
    });
    const sessionId = await initializeSession(server);
    const streamHeaders = {
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
    };

    const first = await dispatchRaw(server, {
      method: "GET",
      headers: streamHeaders
    });
    const second = await dispatchRaw(server, {
      method: "GET",
      headers: streamHeaders
    });
    const third = await dispatch(server, {
      method: "GET",
      headers: streamHeaders
    });

    expect(first.response.statusCode).toBe(200);
    expect(second.response.statusCode).toBe(200);
    expect(third.status).toBe(409);

    await server.notifyToolsChanged();

    expect(Buffer.concat(first.response.chunks).toString("utf8")).not.toContain(
      "notifications/tools/list_changed"
    );
    expect(Buffer.concat(second.response.chunks).toString("utf8")).toContain(
      "notifications/tools/list_changed"
    );

    second.response.end();
    await server.notifyToolsChanged();

    expect(first.response.chunks).toHaveLength(1);
    expect(second.response.chunks).toHaveLength(1);

    first.response.end();
    const replay = await dispatchRaw(server, {
      method: "GET",
      headers: {
        ...streamHeaders,
        "Last-Event-ID": "0"
      }
    });
    const replayText = Buffer.concat(replay.response.chunks).toString("utf8");

    expect(replayText).toContain("id: 1");
    expect(replayText).toContain("id: 2");
    expect(replayText.match(/notifications\/tools\/list_changed/g)).toHaveLength(2);
  });

  it("uses trusted forwarded headers for OAuth metadata only when enabled", async () => {
    const req = {
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-host": "public.example.com",
        "x-forwarded-proto": "https"
      },
      socket: {}
    } as IncomingMessage;

    expect(createBearerChallenge(req, {}, "/mcp", false)).toContain(
      "http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp"
    );
    expect(createBearerChallenge(req, {}, "/mcp", true)).toContain(
      "https://public.example.com/.well-known/oauth-protected-resource/mcp"
    );
  });

  it("enforces OAuth when callers use the public handleRequest entrypoint", async () => {
    const server = createHttpServer({
      name: "handle-request-oauth",
      version: "1.0.0",
      enableJsonResponse: true,
      oauth: {
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        verifier: {
          async verify() {
            throw new Error("not reached");
          }
        }
      }
    });

    const response = await postJsonRpc(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("normalizes unbracketed IPv6 allowed hosts", async () => {
    const server = createHttpServer({
      name: "ipv6-host",
      version: "1.0.0",
      allowedHosts: ["::1"]
    });

    const response = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers: { Host: "[::1]" } }
    );

    expect(response.status).toBe(200);
  });

  it("hardens Express OAuth failures and emits auth failure events", async () => {
    const events: HttpObservabilityEvent[] = [];
    const { mcpMiddleware } = createExpressOAuthHandlers({
      path: "/mcp",
      server: createHttpServer({ name: "express-oauth", version: "1.0.0" }),
      oauth: {
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        verifier: {
          async verify() {
            throw new Error("not reached");
          }
        }
      },
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    });
    const req = {
      headers: { host: "127.0.0.1" },
      socket: {}
    } as IncomingMessage;
    const res = {
      set: vi.fn(),
      status: vi.fn(function status(this: { statusCode?: number }, code: number) {
        this.statusCode = code;
        return this;
      }),
      end: vi.fn()
    };

    await mcpMiddleware(req as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.set).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "auth.failure",
        statusCode: 401
      })
    );
  });

  it("re-exports the production JWKS token verifier", () => {
    expect(createJwksTokenVerifier).toEqual(expect.any(Function));
  });
});
