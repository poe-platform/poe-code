import "../vitest.setup.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { defineSchema } from "tiny-stdio-mcp-server";
import {
  createExpressOAuthHandlers,
  createHttpServer,
  createJwksTokenVerifier,
  createServer,
  type HttpObservabilityEvent,
  type Session,
  type SessionStore,
  StreamableHttpTransport
} from "./index.js";
import { createBearerChallenge } from "./auth.js";
import { createSessionStore } from "./session.js";

const TEST_PROTOCOL_VERSION = "2025-03-26";

interface HttpRequestHandler {
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

async function initializeSession(server: HttpRequestHandler): Promise<string> {
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
  server: HttpRequestHandler,
  message: unknown,
  options: {
    sessionId?: string;
    headers?: HeadersInit;
    omitDefaultHost?: boolean;
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
    body: typeof message === "string" ? message : JSON.stringify(message),
    omitDefaultHost: options.omitDefaultHost
  });
}

async function dispatch(
  server: HttpRequestHandler,
  options: {
    method: string;
    headers?: HeadersInit;
    body?: string;
    url?: string;
    writableLength?: number;
    omitDefaultHost?: boolean;
  }
): Promise<Response> {
  const { response } = await dispatchRaw(server, options);

  return new Response(response.statusCode === 204 ? null : Buffer.concat(response.chunks), {
    status: response.statusCode,
    headers: response.headerValues
  });
}

async function dispatchRaw(
  server: HttpRequestHandler,
  options: {
    method: string;
    headers?: HeadersInit;
    body?: string;
    parsedBody?: unknown;
    url?: string;
    writableLength?: number;
    omitDefaultHost?: boolean;
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
  if (!options.omitDefaultHost && !headers.has("host")) {
    headers.set("host", "127.0.0.1");
  }

  const request = Object.assign(Readable.from(options.body === undefined ? [] : [options.body]), {
    method: options.method,
    url: options.url ?? "/mcp",
    headers: Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value])
    ),
    socket: {},
    ...(options.parsedBody === undefined ? {} : { body: options.parsedBody })
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
  if (options.writableLength !== undefined) {
    Object.defineProperty(response, "writableLength", {
      configurable: true,
      value: options.writableLength
    });
  }
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
  it("bounds default session admission at 128 and reuses deleted capacity", async () => {
    const sessionStore = createSessionStore();
    const transport = new StreamableHttpTransport(
      createServer({ name: "default-session-bound", version: "1.0.0" }),
      { enableJsonResponse: true, sessionStore }
    );
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION } };
    try {
      for (let index = 0; index < 128; index++) {
        expect((await postJsonRpc(transport, initialize)).status).toBe(200);
      }
      expect((await postJsonRpc(transport, initialize)).status).toBe(503);
      const sessions = [...sessionStore.entries!()];
      expect(sessions).toHaveLength(128);
      expect((await dispatch(transport, { method: "DELETE", headers: { "Mcp-Session-Id": sessions[0]!.id } })).status).toBe(204);
      expect((await postJsonRpc(transport, initialize)).status).toBe(200);
      expect([...sessionStore.entries!()]).toHaveLength(128);
    } finally { await transport.close(); }
  });

  for (const enumerable of [true, false]) it(`expires default idle sessions with store enumeration ${enumerable}`, async () => {
    vi.useFakeTimers();
    const backing = createSessionStore();
    const sessionStore: SessionStore = enumerable ? backing : {
      create: backing.create, get: backing.get, delete: backing.delete, has: backing.has, touch: backing.touch
    };
    const transport = new StreamableHttpTransport(
      createServer({ name: "default-session-expiry", version: "1.0.0" }),
      { enableJsonResponse: true, sessionStore }
    );
    try {
      const id = await initializeSession(transport);
      vi.advanceTimersByTime(15 * 60_000);
      expect(backing.has(id)).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(backing.has(id)).toBe(false);
    } finally {
      await transport.close();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it("bounds default authenticated-subject sessions independently", async () => {
    const transport = new StreamableHttpTransport(
      createServer({ name: "subject-session-bound", version: "1.0.0" }),
      { enableJsonResponse: true }
    );
    let subject = "alice";
    const authenticated: HttpRequestHandler = {
      handleRequest(request, response) {
        Object.assign(request, { auth: { subject } });
        return transport.handleRequest(request, response);
      }
    };
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION } };
    try {
      for (let index = 0; index < 16; index++) expect((await postJsonRpc(authenticated, initialize)).status).toBe(200);
      const rejected = await postJsonRpc(authenticated, initialize);
      expect(rejected.status).toBe(429);
      expect(await rejected.json()).toMatchObject({ error: "subject_session_limit_reached" });
      subject = "bob";
      expect((await postJsonRpc(authenticated, initialize)).status).toBe(200);
    } finally { await transport.close(); }
  });

  it("reclaims expired session capacity before the timer sweep", async () => {
    const sessionStore = createSessionStore();
    const transport = new StreamableHttpTransport(
      createServer({ name: "expired-session-capacity", version: "1.0.0" }),
      { enableJsonResponse: true, maxSessions: 1, sessionTtlMs: 60_000, sessionStore }
    );
    try {
      const id = await initializeSession(transport);
      sessionStore.get(id)!.lastSeenAt = new Date(0);
      const next = await postJsonRpc(transport, {
        jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });
      expect(next.status).toBe(200);
      expect(sessionStore.has(id)).toBe(false);
      expect([...sessionStore.entries!()]).toHaveLength(1);
    } finally { await transport.close(); }
  });

  it("counts retained local sessions when a non-enumerable store loses metadata", async () => {
    const backing = createSessionStore();
    const sessionStore: SessionStore = {
      create: backing.create, get: backing.get, delete: backing.delete, has: backing.has, touch: backing.touch
    };
    const transport = new StreamableHttpTransport(
      createServer({ name: "retained-local-session", version: "1.0.0" }),
      { enableJsonResponse: true, maxSessions: 1, sessionStore }
    );
    try {
      const id = await initializeSession(transport);
      backing.delete(id);
      const next = await postJsonRpc(transport, {
        jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });
      expect(next.status).toBe(503);
    } finally { await transport.close(); }
  });

  for (const enumerable of [true, false]) it(`honors subject overrides and client IDs with store enumeration ${enumerable}`, async () => {
    const backing = createSessionStore();
    const sessionStore: SessionStore = enumerable ? backing : {
      create: backing.create, get: backing.get, delete: backing.delete, has: backing.has, touch: backing.touch
    };
    const transport = new StreamableHttpTransport(
      createServer({ name: "subject-override", version: "1.0.0" }),
      { enableJsonResponse: true, maxSessions: 2, maxSessionsPerSubject: 1, sessionStore }
    );
    let clientId = "client-a";
    const authenticated: HttpRequestHandler = {
      handleRequest(request, response) {
        Object.assign(request, { auth: { clientId } });
        return transport.handleRequest(request, response);
      }
    };
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION } };
    try {
      const first = await initializeSession(authenticated);
      expect((await postJsonRpc(authenticated, initialize)).status).toBe(429);
      clientId = "client-b";
      expect((await postJsonRpc(authenticated, initialize)).status).toBe(200);
      expect((await dispatch(authenticated, { method: "DELETE", headers: { "Mcp-Session-Id": first } })).status).toBe(404);
      expect((await postJsonRpc(authenticated, initialize)).status).toBe(503);
      clientId = "client-a";
      expect((await dispatch(authenticated, { method: "DELETE", headers: { "Mcp-Session-Id": first } })).status).toBe(204);
      expect((await postJsonRpc(authenticated, initialize)).status).toBe(200);
      expect([...backing.entries!()]).toHaveLength(2);
    } finally { await transport.close(); }
  });

  it("rejects invalid subject session limits before starting timers", () => {
    const server = createServer({ name: "invalid-subject-limits", version: "1.0.0" });
    for (const maxSessionsPerSubject of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => new StreamableHttpTransport(server, { maxSessionsPerSubject })).toThrow(
        "maxSessionsPerSubject must be an integer greater than or equal to 1."
      );
    }
  });

  it("keeps stateless transports free of session admission and expiry timers", async () => {
    vi.useFakeTimers();
    const sessionStore = createSessionStore();
    const transport = new StreamableHttpTransport(
      createServer({ name: "stateless-session-limits", version: "1.0.0" }),
      { enableJsonResponse: true, sessionIdGenerator: undefined, maxSessions: 1, maxSessionsPerSubject: 1, sessionStore }
    );
    try {
      for (let id = 1; id <= 3; id++) {
        const response = await postJsonRpc(transport, {
          jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION }
        });
        expect(response.status).toBe(200);
        expect(response.headers.has("mcp-session-id")).toBe(false);
      }
      expect([...sessionStore.entries!()]).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await transport.close(); vi.useRealTimers(); }
  });

  async function expectRejection(
    response: Response,
    events: HttpObservabilityEvent[],
    statusCode: number,
    reason: string,
    message: string
  ): Promise<void> {
    expect(response.status).toBe(statusCode);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe(JSON.stringify({ error: reason, message }));
    expect(events.at(-1)).toMatchObject({
      type: "request.end",
      statusCode,
      reason
    });
  }

  it("runs additional request handlers through public handleRequest", async () => {
    const requestHandler = vi.fn((_request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return true;
    });
    const server = createHttpServer({
      name: "mounted-handler",
      version: "1.0.0",
      requestHandler
    });

    const response = await dispatch(server, { method: "GET", url: "/healthz" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(requestHandler).toHaveBeenCalledOnce();
  });

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

  it("rejects an oversized pre-populated request body before creating a session", async () => {
    const sessionIdGenerator = vi.fn(() => "oversized-session");
    const server = createHttpServer({
      name: "pre-parsed-body-limit",
      version: "1.0.0",
      maxRequestBytes: 80,
      sessionIdGenerator
    });
    const { response } = await dispatchRaw(server, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      parsedBody: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION, padding: "é".repeat(40) }
      }
    });
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(Buffer.concat(response.chunks).toString("utf8"))).toMatchObject({
      error: { message: "Payload too large" }
    });
    expect(sessionIdGenerator).not.toHaveBeenCalled();
  });

  it("expires inactive sessions without another request", async () => {
    vi.useFakeTimers();
    const created: string[] = [];
    const deleted: string[] = [];
    const events: HttpObservabilityEvent[] = [];
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
    const transport = new StreamableHttpTransport(
      createServer({ name: "session-store", version: "1.0.0" }),
      {
        sessionIdGenerator: () => "session-a",
        sessionStore,
        sessionTtlMs: 500,
        observability: {
          onEvent: (event) => {
            events.push(event);
          }
        }
      }
    );
    try {
      const sessionId = await initializeSession(transport);
      expect(sessionId).toBe("session-a");
      expect(created).toEqual(["session-a"]);

      vi.advanceTimersByTime(1_001);

      expect(deleted).toContain("session-a");
      expect(events).toContainEqual({
        type: "session.deleted",
        sessionId: "session-a",
        reason: "expired"
      });
    } finally {
      await transport.close();
      expect(vi.getTimerCount()).toBe(0);
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

  it("returns observable JSON reasons for rejected hosts and origins", async () => {
    const events: HttpObservabilityEvent[] = [];
    const server = createHttpServer({
      name: "access-rejections",
      version: "1.0.0",
      allowedHosts: ["mcp.example.com"],
      allowedOrigins: ["https://client.example.com"],
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    });
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    };

    const rejectedHost = await postJsonRpc(server, message, {
      headers: { Host: "attacker.example.com" }
    });
    await expectRejection(
      rejectedHost,
      events,
      403,
      "host_not_allowed",
      'Host "attacker.example.com" is not allowed; add it to allowedHosts.'
    );

    const rejectedOrigin = await postJsonRpc(server, message, {
      headers: {
        Host: "mcp.example.com",
        Origin: "https://attacker.example.com"
      }
    });
    await expectRejection(
      rejectedOrigin,
      events,
      403,
      "origin_not_allowed",
      'Origin "https://attacker.example.com" is not allowed; add it to allowedOrigins.'
    );
  });

  it("returns observable JSON reasons for session rejections on every method", async () => {
    const events: HttpObservabilityEvent[] = [];
    const server = createHttpServer({
      name: "session-rejections",
      version: "1.0.0",
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-rejections-id",
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    });
    const missingSessionRequests = [
      postJsonRpc(server, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
      dispatch(server, { method: "GET", headers: { Accept: "text/event-stream" } }),
      dispatch(server, { method: "DELETE" })
    ];

    for (const pendingResponse of missingSessionRequests) {
      await expectRejection(
        await pendingResponse,
        events,
        400,
        "session_id_required",
        "Mcp-Session-Id is required; initialize a session first."
      );
    }

    const unknownSessionHeaders = {
      "Mcp-Session-Id": "missing-session",
      "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
    };
    const unknownSessionRequests = [
      postJsonRpc(
        server,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { sessionId: "missing-session" }
      ),
      dispatch(server, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...unknownSessionHeaders }
      }),
      dispatch(server, { method: "DELETE", headers: unknownSessionHeaders })
    ];

    for (const pendingResponse of unknownSessionRequests) {
      await expectRejection(
        await pendingResponse,
        events,
        404,
        "session_not_found",
        "Session was not found or has expired; reinitialize the session."
      );
    }

    const sessionId = await initializeSession(server);
    const mismatchedHeaders = {
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": "2099-01-01"
    };
    const protocolMismatchRequests = [
      dispatch(server, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...mismatchedHeaders
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })
      }),
      dispatch(server, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...mismatchedHeaders }
      }),
      dispatch(server, { method: "DELETE", headers: mismatchedHeaders })
    ];

    for (const pendingResponse of protocolMismatchRequests) {
      await expectRejection(
        await pendingResponse,
        events,
        400,
        "protocol_version_mismatch",
        `MCP-Protocol-Version must match the session protocol version ${TEST_PROTOCOL_VERSION}.`
      );
    }
  });

  it("returns observable JSON reasons for negotiation, stream, and session limits", async () => {
    const events: HttpObservabilityEvent[] = [];
    let nextSession = 1;
    const server = createHttpServer({
      name: "capacity-rejections",
      version: "1.0.0",
      enableJsonResponse: true,
      maxSessions: 1,
      sessionIdGenerator: () => `capacity-session-${nextSession++}`,
      observability: {
        onEvent: (event) => {
          events.push(event);
        }
      }
    });

    const rejectedPostAccept = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers: { Accept: "text/plain" } }
    );
    await expectRejection(
      rejectedPostAccept,
      events,
      406,
      "response_type_not_acceptable",
      "Accept must allow application/json."
    );

    const sessionId = await initializeSession(server);
    const rejectedGetAccept = await dispatch(server, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
      }
    });
    await expectRejection(
      rejectedGetAccept,
      events,
      406,
      "response_type_not_acceptable",
      "Accept must allow text/event-stream."
    );

    const streamHeaders = {
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
    };
    const firstStream = await dispatchRaw(server, { method: "GET", headers: streamHeaders });
    const rejectedStream = await dispatch(server, { method: "GET", headers: streamHeaders });
    await expectRejection(
      rejectedStream,
      events,
      409,
      "stream_limit_reached",
      "This session already has the maximum number of streams; close a stream and retry."
    );
    firstStream.response.end();

    const rejectedSession = await postJsonRpc(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });
    await expectRejection(
      rejectedSession,
      events,
      503,
      "session_limit_reached",
      "The server has reached its session limit; close a session or retry later."
    );
  });

  it("validates the forwarded request host when the proxy is trusted", async () => {
    const server = createHttpServer({
      name: "trusted-proxy-host",
      version: "1.0.0",
      allowedHosts: ["mcp.example.com"],
      trustedProxy: true
    });
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    };

    const accepted = await postJsonRpc(server, message, {
      headers: {
        Host: "internal.service.local",
        Origin: "https://mcp.example.com",
        "X-Forwarded-Host": "mcp.example.com",
        "X-Forwarded-Proto": "https"
      }
    });
    const rejected = await postJsonRpc(server, message, {
      headers: {
        Host: "internal.service.local",
        "X-Forwarded-Host": "attacker.example.com"
      }
    });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(403);
  });

  it("preserves requests without a Host header", async () => {
    const server = createHttpServer({
      name: "missing-host",
      version: "1.0.0",
      allowedHosts: ["mcp.example.com"],
      trustedProxy: true
    });
    const response = await postJsonRpc(
      server,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      {
        headers: { "X-Forwarded-Host": "attacker.example.com" },
        omitDefaultHost: true
      }
    );

    expect(response.status).toBe(200);
  });

  it("rejects requests after the transport closes", async () => {
    const events: HttpObservabilityEvent[] = [];
    const transport = new StreamableHttpTransport(
      createServer({ name: "closed-transport", version: "1.0.0" }),
      {
        sessionIdGenerator: () => "unexpected-session",
        observability: {
          onEvent: (event) => {
            events.push(event);
          }
        }
      }
    );

    await transport.close();
    const response = await postJsonRpc(transport, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    await expectRejection(
      response,
      events,
      503,
      "transport_closed",
      "The transport is closed; create or use an active transport."
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "session.created"
      })
    );
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

  it("queues default HTTP concurrency across sessions while retaining each request context", async () => {
    const server = createHttpServer({ name: "shared-http-admission", version: "1", enableJsonResponse: true });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started: string[] = [];
    const finished: string[] = [];
    server.tool("held", "Held work", defineSchema({}), async () => {
      started.push(server.getRequestContext()?.auth?.subject ?? "missing");
      await gate;
      finished.push(server.getRequestContext()?.auth?.subject ?? "missing");
      return "done";
    });
    const authenticated: HttpRequestHandler = {
      handleRequest(request, response) {
        Object.assign(request, { auth: { subject: request.headers["x-test-subject"] } });
        return server.handleRequest(request, response);
      }
    };
    const sessions: string[] = [];
    for (let id = 0; id < 8; id++) {
      const response = await postJsonRpc(authenticated, {
        jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: TEST_PROTOCOL_VERSION }
      }, { headers: { "x-test-subject": String(id) } });
      expect(response.status).toBe(200);
      sessions.push(response.headers.get("mcp-session-id")!);
      expect((await postJsonRpc(authenticated, {
        jsonrpc: "2.0", method: "notifications/initialized"
      }, { sessionId: sessions[id], headers: { "x-test-subject": String(id) } })).status).toBe(202);
    }
    const calls = sessions.map((sessionId, id) => postJsonRpc(authenticated, {
      jsonrpc: "2.0", id, method: "tools/call", params: { name: "held" }
    }, { sessionId, headers: { "x-test-subject": String(id) } }));
    try {
      await setImmediate();
      expect(started).toEqual(["0", "1", "2", "3"]);
      release();
      const responses = await Promise.all(calls);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(await response.json()).toHaveProperty("result");
      }
      expect(started).toEqual(sessions.map((_, id) => String(id)));
      expect(finished).toEqual(started);
    } finally { release(); await Promise.all(calls); }
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

  it("holds handler capacity after timeout while completing HTTP request accounting", async () => {
    const events: HttpObservabilityEvent[] = [];
    let callCount = 0;
    let release!: () => void;
    const pendingHandler = new Promise<string>(resolve => { release = () => resolve("done"); });
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
      return callCount === 1 ? pendingHandler : "done";
    });
    const sessionId = await initializeSession(server);
    try {
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
      const queuedTimeout = await postJsonRpc(
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
      await expect(queuedTimeout.json()).resolves.toMatchObject({
        id: 3,
        error: { code: -32603, message: "Tool call timed out: sometimes-hangs" }
      });
      expect(callCount).toBe(1);
      release();
      await pendingHandler;
      const succeeded = await postJsonRpc(server, {
        jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sometimes-hangs", arguments: {} }
      }, { sessionId });
      await expect(succeeded.json()).resolves.toMatchObject({
        id: 4, result: { content: [{ type: "text", text: "done" }] }
      });
      expect(callCount).toBe(2);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.end",
          toolName: "sometimes-hangs",
          ok: false
        })
      );
    } finally { release(); }
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

  it("ends stalled GET streams while retaining notifications for replay", async () => {
    const server = createHttpServer({
      name: "stream-backpressure",
      version: "1.0.0",
      sessionIdGenerator: () => "stream-backpressure-session"
    });
    const sessionId = await initializeSession(server);
    const streamHeaders = {
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
    };
    const stalled = await dispatchRaw(server, {
      method: "GET",
      headers: streamHeaders,
      writableLength: 1024 * 1024 + 1
    });

    await server.notifyToolsChanged();

    expect(stalled.response.writableEnded).toBe(true);
    expect(stalled.response.chunks).toHaveLength(0);

    const replay = await dispatchRaw(server, {
      method: "GET",
      headers: {
        ...streamHeaders,
        "Last-Event-ID": "0"
      }
    });
    const replayText = Buffer.concat(replay.response.chunks).toString("utf8");

    expect(replayText).toContain("id: 1");
    expect(replayText).toContain("notifications/tools/list_changed");
  });

  it("writes to GET streams whose buffered bytes equal the configured limit", async () => {
    const server = createHttpServer({
      name: "stream-backpressure-boundary",
      version: "1.0.0",
      sessionIdGenerator: () => "stream-backpressure-boundary-session",
      maxStreamBufferBytes: 4
    });
    const sessionId = await initializeSession(server);
    const stream = await dispatchRaw(server, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
      },
      writableLength: 4
    });

    await server.notifyToolsChanged();

    expect(stream.response.writableEnded).toBe(false);
    expect(Buffer.concat(stream.response.chunks).toString("utf8")).toContain(
      "notifications/tools/list_changed"
    );
  });

  it("ends stalled GET streams instead of writing keepalives", async () => {
    const server = createHttpServer({
      name: "keepalive-backpressure",
      version: "1.0.0",
      sessionIdGenerator: () => "keepalive-backpressure-session",
      maxStreamBufferBytes: 4,
      sseKeepAliveMs: 10
    });
    const sessionId = await initializeSession(server);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    try {
      const stalled = await dispatchRaw(server, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "Mcp-Session-Id": sessionId,
          "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
        },
        writableLength: 5
      });

      vi.advanceTimersByTime(10);

      expect(stalled.response.writableEnded).toBe(true);
      expect(stalled.response.chunks).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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

  it("allows OAuth preflight but protects POST through public handleRequest", async () => {
    const server = createHttpServer({
      name: "handle-request-oauth",
      version: "1.0.0",
      enableJsonResponse: true,
      allowedOrigins: ["https://client.example.com"],
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

    const preflight = await dispatch(server, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example.com",
        "Access-Control-Request-Method": "POST"
      }
    });
    const response = await postJsonRpc(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
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
