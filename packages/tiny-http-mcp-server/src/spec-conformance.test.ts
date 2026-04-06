import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { defineSchema } from "tiny-stdio-mcp-server";
import { HttpTransport, McpClient } from "tiny-mcp-client";
import { type HttpServer, type HttpServerHandle } from "./http-server.js";
import { createTestMcpServer, nodeFetch } from "./testing.js";

const TEST_PROTOCOL_VERSION = "2025-03-26";
const TEST_PNG_BASE64 = "iVBORw0KGgo=";
const TEST_MP3_BASE64 = "SUQzBAAAAAA=";
const emptySchema = defineSchema({});
const additionalCleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  for (const cleanup of [...additionalCleanups].reverse()) {
    await cleanup();
  }
  additionalCleanups.clear();
});

interface RequestLogEntry {
  method: string;
  headers: Headers;
  bodyText?: string;
  bodyJson?: unknown;
  responseStatus: number;
  responseContentType: string | null;
  responseSessionId: string | null;
}

interface ConformanceClient {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>;
  close(): Promise<void>;
}

interface ConformancePair {
  client: ConformanceClient;
  url: string;
  requests: RequestLogEntry[];
  currentSessionId(): string | undefined;
  terminateSession(): Promise<void>;
  nextToolChange(): Promise<void>;
  connectSibling(): Promise<ConformancePair>;
  cleanup(): Promise<void>;
}

function trackCleanup(cleanup: () => Promise<void>): void {
  additionalCleanups.add(async () => {
    additionalCleanups.delete(cleanup);
    await cleanup();
  });
}

function createToolChangeTracker(): {
  record(): void;
  next(): Promise<void>;
} {
  let pendingCount = 0;
  const waiters: Array<() => void> = [];

  return {
    record() {
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter();
        return;
      }

      pendingCount += 1;
    },
    async next() {
      if (pendingCount > 0) {
        pendingCount -= 1;
        return;
      }

      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

function createLoggedFetch(
  requests: RequestLogEntry[],
  onResponse?: (response: Response) => void
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    const bodyText =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : undefined;
    let bodyJson: unknown;

    if (bodyText !== undefined && bodyText.length > 0) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }
    }

    const response = await nodeFetch(input, init);

    requests.push({
      method: init.method ?? "GET",
      headers,
      bodyText,
      bodyJson,
      responseStatus: response.status,
      responseContentType: response.headers.get("content-type"),
      responseSessionId: response.headers.get("mcp-session-id"),
    });

    onResponse?.(response);

    return response;
  };
}

async function postJsonRpc(
  url: string,
  message: unknown,
  options: {
    sessionId?: string;
    headers?: HeadersInit;
  } = {}
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...options.headers,
  });

  if (options.sessionId !== undefined) {
    headers.set("Mcp-Session-Id", options.sessionId);
  }

  return nodeFetch(url, {
    method: "POST",
    headers,
    body: typeof message === "string" ? message : JSON.stringify(message),
  });
}

async function openGetStream(url: string, sessionId: string): Promise<Response> {
  return nodeFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
    },
  });
}

async function deleteSession(url: string, sessionId?: string): Promise<Response> {
  const headers = new Headers();

  if (sessionId !== undefined) {
    headers.set("Mcp-Session-Id", sessionId);
  }

  return nodeFetch(url, {
    method: "DELETE",
    headers,
  });
}

async function initializeSession(url: string): Promise<{
  response: Response;
  sessionId: string | null;
}> {
  const response = await postJsonRpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: TEST_PROTOCOL_VERSION },
  });

  return {
    response,
    sessionId: response.headers.get("mcp-session-id"),
  };
}

function parseSseBody(body: string): unknown[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n")
    )
    .map((payload) => JSON.parse(payload));
}

async function readJsonRpcPayload(response: Response): Promise<unknown> {
  const bodyText = await response.text();

  if (bodyText.length === 0) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(bodyText);
  }

  const messages = parseSseBody(bodyText);
  return messages.length === 1 ? messages[0] : messages;
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 500
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for SSE")), timeoutMs);
      }),
    ]);

    if (chunk.done) {
      throw new Error("SSE stream ended before an event was received");
    }

    text += decoder.decode(chunk.value, { stream: true });
    const boundary = text.indexOf("\n\n");

    if (boundary !== -1) {
      return text.slice(0, boundary + 2);
    }
  }
}

async function expectNoSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 100
): Promise<void> {
  const state = await Promise.race([
    reader.read().then(() => "resolved"),
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);

  expect(state).toBe("timeout");
}

function findRequestByMethod(
  requests: RequestLogEntry[],
  method: string,
  jsonRpcMethod?: string
): RequestLogEntry | undefined {
  return requests.find((request) => {
    if (request.method !== method) {
      return false;
    }

    if (jsonRpcMethod === undefined) {
      return true;
    }

    if (typeof request.bodyJson !== "object" || request.bodyJson === null || Array.isArray(request.bodyJson)) {
      return false;
    }

    return (request.bodyJson as { method?: unknown }).method === jsonRpcMethod;
  });
}

function getTextBlock(result: {
  content: Array<Record<string, unknown>>;
}): { type: string; text: string } {
  const first = result.content[0] as { type?: unknown; text?: unknown };

  return {
    type: String(first.type),
    text: String(first.text),
  };
}

function isVisibleAscii(text: string): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      return false;
    }
  }

  return text.length > 0;
}

async function createSdkConnection(
  url: string,
  handle?: HttpServerHandle
): Promise<ConformancePair> {
  const requests: RequestLogEntry[] = [];
  const tracker = createToolChangeTracker();
  const client = new Client({ name: "sdk-conformance-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: createLoggedFetch(requests),
  });
  let cleanedUp = false;

  await client.connect(transport);
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    tracker.record();
  });

  return {
    client: {
      listTools: () => client.listTools(),
      callTool: async (params) =>
        (await client.callTool(params)) as {
          content: Array<Record<string, unknown>>;
          isError?: boolean;
        },
      close: () => client.close(),
    },
    url,
    requests,
    currentSessionId: () => transport.sessionId,
    terminateSession: () => transport.terminateSession(),
    nextToolChange: () => tracker.next(),
    connectSibling: () => createSdkConnection(url),
    cleanup: async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await client.close();
      await handle?.close();
    },
  };
}

async function createTinyConnection(
  url: string,
  handle?: HttpServerHandle
): Promise<ConformancePair> {
  const requests: RequestLogEntry[] = [];
  const tracker = createToolChangeTracker();
  const client = new McpClient({
    clientInfo: { name: "tiny-conformance-client", version: "1.0.0" },
    onToolsChanged: () => {
      tracker.record();
    },
  });
  let currentSessionId: string | undefined;
  let cleanedUp = false;

  const transport = new HttpTransport({
    url,
    fetch: createLoggedFetch(requests, (response) => {
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId !== null && sessionId.length > 0) {
        currentSessionId = sessionId;
      }
    }),
  });

  await client.connect(transport);

  return {
    client: {
      listTools: () => client.listTools(),
      callTool: async (params) =>
        (await client.callTool(params)) as {
          content: Array<Record<string, unknown>>;
          isError?: boolean;
        },
      close: () => client.close(),
    },
    url,
    requests,
    currentSessionId: () => currentSessionId,
    terminateSession: async () => {
      await client.close();
    },
    nextToolChange: () => tracker.next(),
    connectSibling: () => createTinyConnection(url),
    cleanup: async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await client.close();
      await handle?.close();
    },
  };
}

async function createSdkPair(server: HttpServer): Promise<ConformancePair> {
  const handle = await server.listenHttp({ port: 0 });
  return createSdkConnection(handle.url, handle);
}

async function createTinyPair(server: HttpServer): Promise<ConformancePair> {
  const handle = await server.listenHttp({ port: 0 });
  return createTinyConnection(handle.url, handle);
}

function defineConformanceSuite(
  suiteName: string,
  createPair: (server: HttpServer) => Promise<ConformancePair>
): void {
  describe(suiteName, () => {
    let server: HttpServer;
    let pair: ConformancePair;

    beforeEach(async () => {
      server = createTestMcpServer();
      server.tool(
        "notify_during_call",
        "Send a tools changed notification while the call is in flight",
        emptySchema,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await server.notifyToolsChanged();
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "notified";
        }
      );
      pair = await createPair(server);
    });

    afterEach(async () => {
      await pair.cleanup();
    });

    describe("Sending Messages (POST)", () => {
      it("SC1: client sends JSON-RPC via POST", async () => {
        const result = await pair.client.listTools();

        expect(result.tools.some((tool) => tool.name === "echo")).toBe(true);
      });

      it("SC2: client includes Accept header on POST requests", async () => {
        await pair.client.listTools();

        await vi.waitFor(() => {
          const request = findRequestByMethod(pair.requests, "POST", "tools/list");

          expect(request).toBeDefined();
          expect(request?.headers.get("accept")).toBe("application/json, text/event-stream");
        });
      });

      it("SC3: single request POST body is accepted", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );
        const payload = (await readJsonRpcPayload(response)) as {
          result: { tools: Array<{ name: string }> };
        };

        expect(response.status).toBe(200);
        expect(payload.result.tools.some((tool) => tool.name === "echo")).toBe(true);
      });

      it("SC4: batch request POST body is accepted", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          [
            { jsonrpc: "2.0", id: 2, method: "ping" },
            { jsonrpc: "2.0", id: 3, method: "tools/list" },
          ],
          { sessionId: sessionId ?? undefined }
        );
        const payload = (await readJsonRpcPayload(response)) as Array<{ id: number }>;

        expect(response.status).toBe(200);
        expect(payload.map((entry) => entry.id)).toEqual([2, 3]);
      });

      it("SC5: batch notifications POST body is accepted", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          [
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", method: "notifications/initialized" },
          ],
          { sessionId: sessionId ?? undefined }
        );

        expect(response.status).toBe(202);
        expect(await response.text()).toBe("");
      });

      it("SC6: batch responses POST body is accepted", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          [
            { jsonrpc: "2.0", id: 2, result: { ok: true } },
            { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Method not found" } },
          ],
          { sessionId: sessionId ?? undefined }
        );

        expect(response.status).toBe(202);
        expect(await response.text()).toBe("");
      });

      it("SC7: notification-only POST returns 202", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { sessionId: sessionId ?? undefined }
        );

        expect(response.status).toBe(202);
        expect(await response.text()).toBe("");
      });

      it("SC8: response-only POST returns 202", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 9, result: { ok: true } },
          { sessionId: sessionId ?? undefined }
        );

        expect(response.status).toBe(202);
        expect(await response.text()).toBe("");
      });

      it("SC9: request POST returns SSE when JSON responses are disabled", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );

        expect(response.headers.get("content-type")).toContain("text/event-stream");
      });

      it("SC10: request POST returns JSON when JSON responses are enabled", async () => {
        const handle = await createTestMcpServer({
          enableJsonResponse: true,
        }).listenHttp({ port: 0 });
        trackCleanup(handle.close);

        const { sessionId } = await initializeSession(handle.url);
        const response = await postJsonRpc(
          handle.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );

        expect(response.headers.get("content-type")).toBe("application/json");
      });

      it("SC11: SSE response stream contains one JSON-RPC response per request", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );
        const payload = (await readJsonRpcPayload(response)) as {
          id: number;
          result: { tools: Array<{ name: string }> };
        };

        expect(payload.id).toBe(2);
        expect(payload.result.tools.some((tool) => tool.name === "echo")).toBe(true);
      });

      it("SC12: server notifications can be emitted while a POST request is in flight", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const getResponse = await openGetStream(pair.url, sessionId ?? "");
        const reader = getResponse.body?.getReader();

        expect(reader).toBeDefined();

        try {
          const [event, callResponse] = await Promise.all([
            readSseEvent(reader!),
            postJsonRpc(
              pair.url,
              {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "notify_during_call", arguments: {} },
              },
              { sessionId: sessionId ?? undefined }
            ),
          ]);
          const payload = (await readJsonRpcPayload(callResponse)) as {
            result: { content: Array<{ text: string }> };
          };

          expect(event).toContain("notifications/tools/list_changed");
          expect(payload.result.content[0]?.text).toBe("notified");
        } finally {
          await reader?.cancel().catch(() => undefined);
        }
      });

      it("SC13: SSE POST stream closes after all responses are sent", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );
        const reader = response.body?.getReader();

        expect(reader).toBeDefined();

        const firstChunk = await reader!.read();
        const secondChunk = await reader!.read();

        expect(firstChunk.done).toBe(false);
        expect(secondChunk.done).toBe(true);
      });
    });

    describe("Listening (GET)", () => {
      it("SC14: client can open a GET SSE stream", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await openGetStream(pair.url, sessionId ?? "");
        const reader = response.body?.getReader();

        expect(response.status).toBe(200);
        expect(reader).toBeDefined();

        await reader?.cancel().catch(() => undefined);
      });

      it("SC15: client includes Accept: text/event-stream on GET requests", async () => {
        await vi.waitFor(() => {
          const request = pair.requests.find((entry) => entry.method === "GET");

          expect(request).toBeDefined();
          expect(request?.headers.get("accept")).toBe("text/event-stream");
        });
      });

      it("SC16: GET returns text/event-stream", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await openGetStream(pair.url, sessionId ?? "");
        const reader = response.body?.getReader();

        expect(response.headers.get("content-type")).toContain("text/event-stream");

        await reader?.cancel().catch(() => undefined);
      });

      it("SC17: GET returns 405 when the server is stateless", async () => {
        const handle = await createTestMcpServer({
          sessionIdGenerator: undefined,
        }).listenHttp({ port: 0 });
        trackCleanup(handle.close);

        const response = await nodeFetch(handle.url, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
        });

        expect(response.status).toBe(405);
      });

      it("SC18: server can push notifications on the GET stream", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await openGetStream(pair.url, sessionId ?? "");
        const reader = response.body?.getReader();

        expect(reader).toBeDefined();

        try {
          await server.notifyToolsChanged();

          const event = await readSseEvent(reader!);

          expect(event).toContain("notifications/tools/list_changed");
        } finally {
          await reader?.cancel().catch(() => undefined);
        }
      });

      it("SC19: GET stream does not receive JSON-RPC responses for POST requests", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await openGetStream(pair.url, sessionId ?? "");
        const reader = response.body?.getReader();

        expect(reader).toBeDefined();

        try {
          const postResponse = await postJsonRpc(
            pair.url,
            { jsonrpc: "2.0", id: 2, method: "tools/list" },
            { sessionId: sessionId ?? undefined }
          );
          const payload = (await readJsonRpcPayload(postResponse)) as {
            id: number;
            result: { tools: Array<{ name: string }> };
          };

          expect(payload.id).toBe(2);
          await expectNoSseEvent(reader!);
        } finally {
          await reader?.cancel().catch(() => undefined);
        }
      });
    });

    describe("Session Management", () => {
      it("SC20: initialize assigns Mcp-Session-Id", async () => {
        const { response, sessionId } = await initializeSession(pair.url);

        expect(response.status).toBe(200);
        expect(sessionId).toBeTruthy();
      });

      it("SC21: session IDs use visible ASCII characters", async () => {
        const { sessionId } = await initializeSession(pair.url);

        expect(typeof sessionId).toBe("string");
        expect(isVisibleAscii(sessionId ?? "")).toBe(true);
      });

      it("SC22: client includes the session ID on subsequent requests", async () => {
        await pair.client.listTools();

        await vi.waitFor(() => {
          const sessionId = pair.currentSessionId();
          const request = findRequestByMethod(pair.requests, "POST", "tools/list");

          expect(sessionId).toBeDefined();
          expect(request?.headers.get("mcp-session-id")).toBe(sessionId);
        });
      });

      it("SC23: missing session ID on a non-initialize request returns 400", async () => {
        await initializeSession(pair.url);

        const response = await postJsonRpc(pair.url, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        });

        expect(response.status).toBe(400);
      });

      it("SC24: deleted sessions return 404 on subsequent requests", async () => {
        const { sessionId } = await initializeSession(pair.url);

        expect(sessionId).toBeTruthy();

        const deleteResponse = await deleteSession(pair.url, sessionId ?? undefined);
        const postDeleteResponse = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: sessionId ?? undefined }
        );

        expect(deleteResponse.status).toBe(204);
        expect(postDeleteResponse.status).toBe(404);
      });

      it("SC25: clients can establish a new session after a 404", async () => {
        const expiredSessionId = pair.currentSessionId();

        expect(expiredSessionId).toBeDefined();

        await deleteSession(pair.url, expiredSessionId);
        await expect(pair.client.listTools()).rejects.toThrow();

        const sibling = await pair.connectSibling();
        trackCleanup(sibling.cleanup);

        const tools = await sibling.client.listTools();

        expect(sibling.currentSessionId()).toBeDefined();
        expect(sibling.currentSessionId()).not.toBe(expiredSessionId);
        expect(tools.tools.some((tool) => tool.name === "echo")).toBe(true);
      });

      it("SC26: the client can send DELETE to terminate its session", async () => {
        const sessionId = pair.currentSessionId();

        expect(sessionId).toBeDefined();

        await pair.terminateSession();

        await vi.waitFor(() => {
          const request = pair.requests.find((entry) => entry.method === "DELETE");

          expect(request).toBeDefined();
          expect(request?.headers.get("mcp-session-id")).toBe(sessionId);
        });
      });

      it("SC27: DELETE returns 405 when sessions are unsupported", async () => {
        const handle = await createTestMcpServer({
          sessionIdGenerator: undefined,
        }).listenHttp({ port: 0 });
        trackCleanup(handle.close);

        const response = await deleteSession(handle.url);

        expect(response.status).toBe(405);
      });
    });

    describe("Unsupported Methods", () => {
      it("SC28: PUT returns 405", async () => {
        const response = await nodeFetch(pair.url, { method: "PUT" });

        expect(response.status).toBe(405);
      });

      it("SC29: PATCH returns 405", async () => {
        const response = await nodeFetch(pair.url, { method: "PATCH" });

        expect(response.status).toBe(405);
      });
    });

    describe("Tool Content Types", () => {
      it("SC30: text tool results round-trip", async () => {
        const result = await pair.client.callTool({
          name: "echo",
          arguments: { text: "hello" },
        });

        expect(result.content).toEqual([{ type: "text", text: "hello" }]);
      });

      it("SC31: structured JSON results round-trip", async () => {
        const result = await pair.client.callTool({
          name: "get_user",
          arguments: { id: "user-7" },
        });
        const textBlock = getTextBlock(result);

        expect(textBlock.type).toBe("text");
        expect(JSON.parse(textBlock.text)).toEqual({
          id: "user-7",
          name: "Alice",
          role: "admin",
        });
      });

      it("SC32: image content round-trips", async () => {
        const result = await pair.client.callTool({
          name: "get_image",
          arguments: {},
        });

        expect(result.content).toEqual([
          {
            type: "image",
            data: TEST_PNG_BASE64,
            mimeType: "image/png",
          },
        ]);
      });

      it("SC33: audio content round-trips", async () => {
        const result = await pair.client.callTool({
          name: "get_audio",
          arguments: {},
        });

        expect(result.content).toEqual([
          {
            type: "audio",
            data: TEST_MP3_BASE64,
            mimeType: "audio/mpeg",
          },
        ]);
      });

      it("SC34: file content round-trips", async () => {
        const result = await pair.client.callTool({
          name: "get_file",
          arguments: {},
        });

        expect(result.content).toEqual([
          {
            type: "resource",
            resource: {
              uri: "file:///data",
              mimeType: "text/csv",
              text: "hello,world",
            },
          },
        ]);
      });

      it("SC35: mixed content round-trips", async () => {
        const result = await pair.client.callTool({
          name: "get_mixed",
          arguments: {},
        });

        expect(result.content).toEqual([
          {
            type: "image",
            data: TEST_PNG_BASE64,
            mimeType: "image/png",
          },
          {
            type: "text",
            text: "Caption for the image",
          },
          {
            type: "resource",
            resource: {
              uri: "file:///data",
              mimeType: "text/plain",
              text: "notes",
            },
          },
        ]);
      });

      it("SC36: undefined results round-trip as an empty content array", async () => {
        const result = await pair.client.callTool({
          name: "empty_result",
          arguments: {},
        });

        expect(result.content).toEqual([]);
      });

      it("SC37: large outputs round-trip without truncation", async () => {
        const result = await pair.client.callTool({
          name: "large_output",
          arguments: {},
        });
        const textBlock = getTextBlock(result);

        expect(textBlock.text).toHaveLength(100_000);
      });
    });

    describe("Error Handling", () => {
      it("SC38: synchronous tool throws become isError results", async () => {
        const result = await pair.client.callTool({
          name: "throw_sync",
          arguments: {},
        });
        const textBlock = getTextBlock(result);

        expect(result.isError).toBe(true);
        expect(textBlock.text).toBe("Error: sync boom");
      });

      it("SC39: asynchronous tool throws become isError results", async () => {
        const result = await pair.client.callTool({
          name: "throw_async",
          arguments: {},
        });
        const textBlock = getTextBlock(result);

        expect(result.isError).toBe(true);
        expect(textBlock.text).toBe("Error: async boom");
      });

      it("SC40: unknown tools return JSON-RPC -32602", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "missing", arguments: {} },
          },
          { sessionId: sessionId ?? undefined }
        );

        expect(await readJsonRpcPayload(response)).toEqual({
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32602, message: "Tool not found: missing" },
        });
      });

      it("SC41: unknown methods return JSON-RPC -32601", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "missing/method" },
          { sessionId: sessionId ?? undefined }
        );

        expect(await readJsonRpcPayload(response)).toEqual({
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32601, message: "Method not found" },
        });
      });

      it("SC42: invalid JSON bodies return 400", async () => {
        const response = await postJsonRpc(pair.url, '{"jsonrpc":"2.0"', {
          headers: { "Content-Type": "application/json" },
        });

        expect(response.status).toBe(400);
        expect(await readJsonRpcPayload(response)).toEqual({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
      });
    });

    describe("Dynamic Tools", () => {
      it("SC43: added tools appear in tools/list after initialization", async () => {
        server.tool("dynamic_add", "Dynamic add", emptySchema, () => "added");

        const result = await pair.client.listTools();

        expect(result.tools.some((tool) => tool.name === "dynamic_add")).toBe(true);
      });

      it("SC44: removed tools disappear from tools/list after initialization", async () => {
        expect(server.removeTool("uppercase")).toBe(true);

        const result = await pair.client.listTools();

        expect(result.tools.some((tool) => tool.name === "uppercase")).toBe(false);
      });

      it("SC45: notifyToolsChanged is delivered to the client", async () => {
        await vi.waitFor(() => {
          expect(pair.requests.some((request) => request.method === "GET")).toBe(true);
        });

        const notification = pair.nextToolChange();

        await server.notifyToolsChanged();
        await notification;
      });
    });

    describe("Batch Requests", () => {
      it("SC46: a batch of 3 requests returns 3 responses", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          [
            { jsonrpc: "2.0", id: 2, method: "ping" },
            { jsonrpc: "2.0", id: 3, method: "tools/list" },
            {
              jsonrpc: "2.0",
              id: 4,
              method: "tools/call",
              params: { name: "echo", arguments: { text: "batch" } },
            },
          ],
          { sessionId: sessionId ?? undefined }
        );
        const payload = (await readJsonRpcPayload(response)) as Array<{ id: number }>;

        expect(payload.map((entry) => entry.id)).toEqual([2, 3, 4]);
      });

      it("SC47: mixed request and notification batches return only request responses", async () => {
        const { sessionId } = await initializeSession(pair.url);
        const response = await postJsonRpc(
          pair.url,
          [
            { jsonrpc: "2.0", id: 2, method: "ping" },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", id: 3, method: "tools/list" },
          ],
          { sessionId: sessionId ?? undefined }
        );
        const payload = (await readJsonRpcPayload(response)) as Array<{ id: number }>;

        expect(payload.map((entry) => entry.id)).toEqual([2, 3]);
      });
    });

    describe("Concurrency", () => {
      it("SC48: two clients establish separate sessions", async () => {
        const sibling = await pair.connectSibling();
        trackCleanup(sibling.cleanup);

        const [firstTools, secondTools] = await Promise.all([
          pair.client.listTools(),
          sibling.client.listTools(),
        ]);

        expect(pair.currentSessionId()).toBeDefined();
        expect(sibling.currentSessionId()).toBeDefined();
        expect(pair.currentSessionId()).not.toBe(sibling.currentSessionId());
        expect(firstTools.tools).toHaveLength(secondTools.tools.length);
      });

      it("SC49: concurrent requests on the same session both resolve", async () => {
        const [echoResult, uppercaseResult] = await Promise.all([
          pair.client.callTool({
            name: "echo",
            arguments: { text: "parallel-a" },
          }),
          pair.client.callTool({
            name: "uppercase",
            arguments: { text: "parallel-b" },
          }),
        ]);

        expect(echoResult.content).toEqual([{ type: "text", text: "parallel-a" }]);
        expect(uppercaseResult.content).toEqual([{ type: "text", text: "PARALLEL-B" }]);
      });

      it("SC50: deleting one client session does not affect another client", async () => {
        const sibling = await pair.connectSibling();
        trackCleanup(sibling.cleanup);
        const deletedSessionId = pair.currentSessionId();

        expect(deletedSessionId).toBeDefined();

        await pair.terminateSession();

        const secondTools = await sibling.client.listTools();
        const deletedSessionResponse = await postJsonRpc(
          pair.url,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          { sessionId: deletedSessionId }
        );

        expect(secondTools.tools.some((tool) => tool.name === "echo")).toBe(true);
        expect(deletedSessionResponse.status).toBe(404);
      });
    });
  });
}

defineConformanceSuite("Spec conformance (MCP SDK client)", createSdkPair);
defineConformanceSuite("Spec conformance (tiny-mcp-client)", createTinyPair);
