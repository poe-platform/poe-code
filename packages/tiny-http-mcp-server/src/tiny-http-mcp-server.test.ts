import "../vitest.setup.js";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createServer,
  defineSchema,
  Audio,
  File,
  Image,
  JSON_RPC_ERROR_CODES,
  toContentBlocks,
  fileTypeFromBuffer
} from "tiny-stdio-mcp-server";
import type {
  AudioContent,
  BlobResourceContents,
  CallToolResult,
  ContentBlock,
  ContentItem,
  EmbeddedResource,
  FileTypeResult,
  HandleResult,
  ImageContent,
  InitializeResult,
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONSchema,
  JSONSchemaProperty,
  SDKTransport,
  Server,
  ServerOptions,
  TextContent,
  TextResourceContents,
  Tool,
  ToolDefinition,
  ToolHandler,
  ToolReturn,
  Transport,
  TypedSchema
} from "tiny-stdio-mcp-server";
import { HttpTransport, McpClient } from "tiny-mcp-client";
import { StreamableHttpTransport } from "./http-transport.js";
import { createExpressMiddleware } from "./express-middleware.js";
import { createHttpServer, createProtectedResourceMetadataDocument } from "./http-server.js";
import type {
  HttpListenOptions,
  HttpServer,
  HttpServerHandle,
  HttpTransportOptions
} from "./http-server.js";
import { runCli } from "./cli.js";
import { createSessionStore, defaultSessionIdGenerator } from "./session.js";
import { formatSseEvent, SSE_HEADERS } from "./sse.js";
import { readAndClassifyBody } from "./parse-body.js";
import {
  createHttpTestPair,
  createHttpTestPairWithTinyClient,
  createTestMcpServer,
  nodeFetch
} from "./testing.js";

function hasOwnErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_PROTOCOL_VERSION = "2025-03-26";

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
      })
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

async function readJsonRpcPayload(response: Response): Promise<unknown> {
  const bodyText = await response.text();

  if (bodyText.length === 0) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(bodyText);
  }

  const messages = bodyText
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

  return messages.length === 1 ? messages[0] : messages;
}

// ---------------------------------------------------------------------------
// parse-body helper
// ---------------------------------------------------------------------------

function createRequest(
  body: string,
  extras?: { body?: unknown }
): IncomingMessage & { body?: unknown } {
  return Object.assign(Readable.from([body]), extras) as IncomingMessage & {
    body?: unknown;
  };
}

// ---------------------------------------------------------------------------
// sse.test.ts
// ---------------------------------------------------------------------------

describe("sse", () => {
  it("S1: formats basic SSE event with data only", () => {
    expect(formatSseEvent({ data: "hello" })).toBe("data: hello\n\n");
  });

  it("S2: formats event with id field", () => {
    expect(formatSseEvent({ id: "42", data: "hello" })).toBe("id: 42\ndata: hello\n\n");
  });

  it("S3: formats event with event type", () => {
    expect(formatSseEvent({ event: "message", data: "hello" })).toBe(
      "event: message\ndata: hello\n\n"
    );
  });

  it("S4: formats event with all fields in correct order", () => {
    expect(formatSseEvent({ id: "42", event: "message", data: "hello" })).toBe(
      "id: 42\nevent: message\ndata: hello\n\n"
    );
  });

  it("S5: handles empty data string", () => {
    expect(formatSseEvent({ data: "" })).toBe("data: \n\n");
  });

  it("S6: handles data with special characters", () => {
    expect(formatSseEvent({ data: '{"message":"hello","text":"zażółć 😀"}' })).toBe(
      'data: {"message":"hello","text":"zażółć 😀"}\n\n'
    );
  });

  it("S7: SSE_HEADERS contains correct content-type", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
  });

  it("S8: SSE_HEADERS contains cache-control", () => {
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache");
  });

  it("S9: SSE_HEADERS contains connection", () => {
    expect(SSE_HEADERS.Connection).toBe("keep-alive");
  });

  it("formats multiline data as multiple data lines", () => {
    expect(formatSseEvent({ data: "first\r\nsecond\nthird\rfourth" })).toBe(
      "data: first\ndata: second\ndata: third\ndata: fourth\n\n"
    );
  });
});

// ---------------------------------------------------------------------------
// session.test.ts
// ---------------------------------------------------------------------------

describe("session", () => {
  it("SS1: defaultSessionIdGenerator() returns non-empty string", () => {
    expect(defaultSessionIdGenerator()).toBeTypeOf("string");
    expect(defaultSessionIdGenerator().length).toBeGreaterThan(0);
  });

  it("SS2: session IDs are unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => defaultSessionIdGenerator()));

    expect(ids).toHaveLength(100);
  });

  it("SS3: session ID is visible ASCII", () => {
    const id = defaultSessionIdGenerator();

    for (const character of id) {
      const codePoint = character.charCodeAt(0);

      expect(codePoint).toBeGreaterThanOrEqual(0x21);
      expect(codePoint).toBeLessThanOrEqual(0x7e);
    }
  });

  it("SS4: create(id) stores session, has(id) returns true", () => {
    const store = createSessionStore();
    const session = store.create("session-1");

    expect(session.id).toBe("session-1");
    expect(store.has("session-1")).toBe(true);
  });

  it("SS5: get(id) returns session with id, initialized, createdAt", () => {
    const store = createSessionStore();

    store.create("session-1");

    expect(store.get("session-1")).toEqual({
      id: "session-1",
      initialized: false,
      createdAt: expect.any(Date),
      lastSeenAt: expect.any(Date)
    });
  });

  it("SS6: get(unknownId) returns undefined", () => {
    const store = createSessionStore();

    expect(store.get("unknown-session")).toBeUndefined();
  });

  it("SS7: delete(id) removes session", () => {
    const store = createSessionStore();

    store.create("session-1");

    expect(store.delete("session-1")).toBe(true);
    expect(store.has("session-1")).toBe(false);
    expect(store.get("session-1")).toBeUndefined();
  });

  it("SS8: delete(unknownId) returns false", () => {
    const store = createSessionStore();

    expect(store.delete("unknown-session")).toBe(false);
  });

  it("SS9: has(unknownId) returns false", () => {
    const store = createSessionStore();

    expect(store.has("unknown-session")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parse-body.test.ts
// ---------------------------------------------------------------------------

describe("readAndClassifyBody", () => {
  it("P1 parses single request", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    );

    expect(parsed.messages).toEqual([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    expect(parsed.requests).toEqual(parsed.messages);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([]);
  });

  it("P2 parses single notification", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    );

    expect(parsed.messages).toEqual([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual(parsed.messages);
    expect(parsed.responses).toEqual([]);
  });

  it("P3 parses single response", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    );

    expect(parsed.messages).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual(parsed.messages);
  });

  it("P4 parses batch of requests", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"pong"}]'
      )
    );

    expect(parsed.requests).toEqual([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "pong" }
    ]);
    expect(parsed.messages).toEqual(parsed.requests);
  });

  it("P5 parses batch of notifications", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('[{"jsonrpc":"2.0","method":"note/one"},{"jsonrpc":"2.0","method":"note/two"}]')
    );

    expect(parsed.notifications).toEqual([
      { jsonrpc: "2.0", method: "note/one" },
      { jsonrpc: "2.0", method: "note/two" }
    ]);
    expect(parsed.messages).toEqual(parsed.notifications);
  });

  it("P6 parses batch of responses", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":1,"result":"ok"},{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"boom"}}]'
      )
    );

    expect(parsed.responses).toEqual([
      { jsonrpc: "2.0", id: 1, result: "ok" },
      {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32603, message: "boom" }
      }
    ]);
    expect(parsed.messages).toEqual(parsed.responses);
  });

  it("P7 parses mixed batch with requests and notifications", async () => {
    const parsed = await readAndClassifyBody(
      createRequest(
        '[{"jsonrpc":"2.0","id":"r1","method":"tools/list"},{"jsonrpc":"2.0","method":"notifications/initialized"}]'
      )
    );

    expect(parsed.requests).toEqual([{ jsonrpc: "2.0", id: "r1", method: "tools/list" }]);
    expect(parsed.notifications).toEqual([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(parsed.responses).toEqual([]);
  });

  it("P8 classifies requests-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('[{"jsonrpc":"2.0","id":1,"method":"a"},{"jsonrpc":"2.0","id":2,"method":"b"}]')
    );

    expect(parsed.hasRequests).toBe(true);
    expect(parsed.hasNotifications).toBe(false);
    expect(parsed.hasResponses).toBe(false);
  });

  it("P9 classifies notifications-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('[{"jsonrpc":"2.0","method":"a"},{"jsonrpc":"2.0","method":"b"}]')
    );

    expect(parsed.hasRequests).toBe(false);
    expect(parsed.hasNotifications).toBe(true);
    expect(parsed.hasResponses).toBe(false);
  });

  it("P10 classifies responses-only payload", async () => {
    const parsed = await readAndClassifyBody(
      createRequest('[{"jsonrpc":"2.0","id":1,"result":"a"},{"jsonrpc":"2.0","id":2,"result":"b"}]')
    );

    expect(parsed.hasRequests).toBe(false);
    expect(parsed.hasNotifications).toBe(false);
    expect(parsed.hasResponses).toBe(true);
  });

  it("P11 rejects invalid JSON", async () => {
    await expect(readAndClassifyBody(createRequest('{"jsonrpc":"2.0"'))).rejects.toThrow(
      "Parse error"
    );
  });

  it("P12 rejects non-object number body", async () => {
    await expect(readAndClassifyBody(createRequest("123"))).rejects.toThrow("Invalid Request");
  });

  it("P13 rejects non-object string body", async () => {
    await expect(readAndClassifyBody(createRequest('"hello"'))).rejects.toThrow("Invalid Request");
  });

  it("P14 rejects non-object null body", async () => {
    await expect(readAndClassifyBody(createRequest("null"))).rejects.toThrow("Invalid Request");
  });

  it("P15 rejects message missing jsonrpc field", async () => {
    await expect(readAndClassifyBody(createRequest('{"id":1,"method":"ping"}'))).rejects.toThrow(
      "Invalid Request"
    );
  });

  it("P16 rejects empty array", async () => {
    await expect(readAndClassifyBody(createRequest("[]"))).rejects.toThrow("Invalid Request");
  });

  it("P17 accepts pre-parsed body object", async () => {
    const parsed = await readAndClassifyBody(createRequest("ignored"), {
      jsonrpc: "2.0",
      id: 7,
      method: "ping"
    });

    expect(parsed.messages).toEqual([{ jsonrpc: "2.0", id: 7, method: "ping" }]);
    expect(parsed.requests).toEqual(parsed.messages);
  });

  it("P18 accepts pre-parsed body array", async () => {
    const parsed = await readAndClassifyBody(createRequest("ignored"), [
      { jsonrpc: "2.0", method: "note/one" },
      { jsonrpc: "2.0", id: "res-1", result: { ok: true } }
    ]);

    expect(parsed.notifications).toEqual([{ jsonrpc: "2.0", method: "note/one" }]);
    expect(parsed.responses).toEqual([{ jsonrpc: "2.0", id: "res-1", result: { ok: true } }]);
  });

  it("P19 identifies request by method and id", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", id: "req-1", method: "tools/call" }
      })
    );

    expect(parsed.requests).toEqual([{ jsonrpc: "2.0", id: "req-1", method: "tools/call" }]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([]);
  });

  it("P20 identifies notification by method and no id", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", method: "notifications/progress" }
      })
    );

    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([{ jsonrpc: "2.0", method: "notifications/progress" }]);
    expect(parsed.responses).toEqual([]);
  });

  it("P21 identifies response by result or error, id, and no method", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("ignored", {
        body: { jsonrpc: "2.0", id: "req-1", result: { ok: true } }
      })
    );

    expect(parsed.requests).toEqual([]);
    expect(parsed.notifications).toEqual([]);
    expect(parsed.responses).toEqual([{ jsonrpc: "2.0", id: "req-1", result: { ok: true } }]);
  });

  it("rejects a message that mixes request and response fields", async () => {
    await expect(
      readAndClassifyBody(
        createRequest('{"jsonrpc":"2.0","id":1,"method":"ping","result":{"ok":true}}')
      )
    ).rejects.toThrow("Invalid Request");
  });

  it("prefers req.body over the stream body when both exist", async () => {
    const parsed = await readAndClassifyBody(
      createRequest("not-json", {
        body: { jsonrpc: "2.0", id: "req-1", method: "tools/list" }
      })
    );

    expect(parsed.requests).toEqual([{ jsonrpc: "2.0", id: "req-1", method: "tools/list" }]);
  });
});

// ---------------------------------------------------------------------------
// index.test.ts
// ---------------------------------------------------------------------------

describe("tiny-http-mcp-server", () => {
  it("re-exports the full runtime entrypoint surface", async () => {
    expect(createServer).toBeTypeOf("function");
    expect(defineSchema).toBeTypeOf("function");
    expect(Image.fromBase64).toBeTypeOf("function");
    expect(Audio.fromBase64).toBeTypeOf("function");
    expect(File.fromText).toBeTypeOf("function");
    expect(toContentBlocks).toBeTypeOf("function");
    expect(fileTypeFromBuffer).toBeTypeOf("function");
    expect(JSON_RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(createExpressMiddleware).toBeTypeOf("function");
    expect(createHttpServer).toBeTypeOf("function");
    expect(createProtectedResourceMetadataDocument).toBeTypeOf("function");
    expect(createTestMcpServer).toBeTypeOf("function");
    expect(createHttpTestPair).toBeTypeOf("function");
    expect(createHttpTestPairWithTinyClient).toBeTypeOf("function");

    expect(fileTypeFromBuffer(Uint8Array.from([]))).toBeUndefined();
  });

  it("creates an HTTP server with the runtime helpers attached", () => {
    const server = createHttpServer({ name: "test-server", version: "1.0.0" });

    expect(server.tool).toBeTypeOf("function");
    expect(server.listenHttp).toBeTypeOf("function");
    expect(server.handleRequest).toBeTypeOf("function");
  });

  it("re-exports the stdio and HTTP type surface", () => {
    expectTypeOf<Server>().toMatchTypeOf<{
      tool: (...args: unknown[]) => Server;
      handleMessage: (...args: unknown[]) => Promise<HandleResult>;
    }>();
    expectTypeOf<TypedSchema<{ text: string }>>().toMatchTypeOf<JSONSchema>();
    expectTypeOf<ImageContent>().toMatchTypeOf<ContentItem>();
    expectTypeOf<AudioContent>().toMatchTypeOf<ContentItem>();
    expectTypeOf<EmbeddedResource>().toMatchTypeOf<ContentItem>();
    expectTypeOf<TextResourceContents>().toMatchTypeOf<{
      uri: string;
      mimeType: string;
      text: string;
    }>();
    expectTypeOf<BlobResourceContents>().toMatchTypeOf<{
      uri: string;
      mimeType: string;
      blob: string;
    }>();
    expectTypeOf<ContentBlock>().toMatchTypeOf<ContentItem>();
    expectTypeOf<TextContent>().toMatchTypeOf<{ type: "text"; text: string }>();
    expectTypeOf<FileTypeResult>().toMatchTypeOf<{
      ext: string;
      mime: string;
    }>();
    expectTypeOf<ToolReturn>().toMatchTypeOf<unknown>();
    expectTypeOf<ServerOptions>().toMatchTypeOf<{ name: string; version: string }>();
    expectTypeOf<ServerOptions["toolCallTimeoutMs"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ToolHandler<{ text: string }>>().toMatchTypeOf<
      (args: { text: string }) => ToolReturn | Promise<ToolReturn>
    >();
    expectTypeOf<ToolDefinition<{ text: string }>>().toMatchTypeOf<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
      handler: ToolHandler<{ text: string }>;
    }>();
    expectTypeOf<Tool>().toMatchTypeOf<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
    }>();
    expectTypeOf<CallToolResult>().toMatchTypeOf<{
      content: ContentItem[];
      isError?: boolean;
    }>();
    expectTypeOf<HandleResult>().toMatchTypeOf<{
      result?: unknown;
      error?: { code: number; message: string };
    }>();
    expectTypeOf<JSONSchemaProperty>().toMatchTypeOf<{
      type: "string" | "number" | "boolean" | "object" | "array";
      description?: string;
    }>();
    expectTypeOf<Transport>().toMatchTypeOf<{
      readable: NodeJS.ReadableStream;
      writable: NodeJS.WritableStream;
    }>();
    expectTypeOf<SDKTransport>().toMatchTypeOf<{
      start: () => Promise<void>;
      close: () => Promise<void>;
      send: (message: JSONRPCMessage) => Promise<void>;
    }>();
    expectTypeOf<JSONRPCRequest>().toMatchTypeOf<{
      jsonrpc: "2.0";
      id: string | number;
      method: string;
      params?: Record<string, unknown>;
    }>();
    expectTypeOf<JSONRPCResponse>().toMatchTypeOf<{
      jsonrpc: "2.0";
      id: string | number | null;
      result?: unknown;
      error?: JSONRPCError;
    }>();
    expectTypeOf<JSONRPCError>().toMatchTypeOf<{
      code: number;
      message: string;
      data?: unknown;
    }>();
    expectTypeOf<JSONRPCNotification>().toMatchTypeOf<{
      jsonrpc: "2.0";
      method: string;
      params?: Record<string, unknown>;
    }>();
    expectTypeOf<InitializeResult>().toMatchTypeOf<{
      protocolVersion: string;
      capabilities: { tools?: { listChanged?: boolean } };
      serverInfo: { name: string; version: string };
    }>();
    expectTypeOf<HttpTransportOptions>().toMatchTypeOf<ServerOptions>();
    expectTypeOf<HttpListenOptions>().toMatchTypeOf<{
      port?: number;
      hostname?: string;
      path?: string;
      signal?: AbortSignal;
    }>();
    expectTypeOf<HttpServerHandle>().toMatchTypeOf<{
      url: string;
      port: number;
      close: () => Promise<void>;
      closeAllConnections: () => void;
    }>();
    expectTypeOf<HttpServer>().toMatchTypeOf<{
      tool: (...args: unknown[]) => HttpServer;
      listenHttp: (options?: HttpListenOptions) => Promise<HttpServerHandle>;
    }>();
  });
});

// ---------------------------------------------------------------------------
// http-transport.test.ts
// ---------------------------------------------------------------------------

describe("StreamableHttpTransport", () => {
  interface FixtureOptions {
    enableJsonResponse?: boolean;
    sessionIdGenerator?: (() => string) | undefined;
    maxStreamsPerSession?: number;
    sseKeepAliveMs?: number;
  }

  interface Fixture {
    server: ReturnType<typeof createServer>;
    transport: StreamableHttpTransport;
    url: string;
    close(): Promise<void>;
    request(method: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>;
    post(body: unknown, options?: RequestOptions): Promise<TestResponse>;
    get(options?: RequestOptions): Promise<TestResponse>;
    delete(options?: RequestOptions): Promise<TestResponse>;
    initialize(): Promise<{ response: TestResponse; sessionId: string | null }>;
  }

  interface RequestOptions {
    sessionId?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }

  interface TestResponse {
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }

  const fixtures = new Set<Fixture>();

  afterEach(async () => {
    for (const fixture of fixtures) {
      await fixture.close();
    }
    fixtures.clear();
  });

  async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
    const server = createServer({ name: "http-test", version: "1.0.0" })
      .tool("echo", "Echo text", defineSchema({ text: { type: "string" } }), ({ text }) =>
        String(text)
      )
      .tool("explode", "Throw", defineSchema({}), () => {
        throw new Error("boom");
      });

    const transport = new StreamableHttpTransport(server, options);
    const httpServer = http.createServer(async (req, res) => {
      await transport.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;

    const sendRequest = async (
      method: string,
      body: unknown,
      requestOptions: RequestOptions = {}
    ): Promise<TestResponse> => {
      const headers: Record<string, string> = {
        ...requestOptions.headers
      };

      if (requestOptions.sessionId !== undefined) {
        headers["Mcp-Session-Id"] = requestOptions.sessionId;
        headers["MCP-Protocol-Version"] = "2025-03-26";
      }

      let payload: string | undefined;
      if (body !== undefined) {
        payload = typeof body === "string" ? body : JSON.stringify(body);
      }

      return nodeFetch(url, {
        method,
        headers,
        signal: requestOptions.signal,
        ...(payload === undefined ? {} : { body: payload })
      });
    };

    const fixture: Fixture = {
      server,
      transport,
      url,
      async close() {
        await transport.close();
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      },
      async request(method, body, requestOptions = {}) {
        return sendRequest(method, body, requestOptions);
      },
      async post(body, requestOptions = {}) {
        return sendRequest("POST", body, {
          ...requestOptions,
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...requestOptions.headers
          }
        });
      },
      async get(requestOptions = {}) {
        return sendRequest("GET", undefined, {
          ...requestOptions,
          headers: {
            Accept: "text/event-stream",
            ...requestOptions.headers
          }
        });
      },
      async delete(requestOptions = {}) {
        return sendRequest("DELETE", undefined, requestOptions);
      },
      async initialize() {
        const response = await this.post({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" }
        });

        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId !== null) {
          await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId });
        }

        return {
          response,
          sessionId
        };
      }
    };

    fixtures.add(fixture);

    return fixture;
  }

  function parseSseBody(body: string): unknown[] {
    const blocks = body
      .split("\n\n")
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    return blocks.map((block) => {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");

      return JSON.parse(data);
    });
  }

  function countOccurrences(text: string, target: string): number {
    let count = 0;
    let index = 0;

    while (true) {
      const matchIndex = text.indexOf(target, index);

      if (matchIndex === -1) {
        return count;
      }

      count += 1;
      index = matchIndex + target.length;
    }
  }

  async function readJsonRpcBody(response: TestResponse): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (text.length === 0) {
      return null;
    }

    if (contentType.includes("text/event-stream")) {
      const events = parseSseBody(text);
      return events.length === 1 ? events[0] : events;
    }

    return JSON.parse(text);
  }

  async function expectReaderToStayOpen(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs = 20
  ): Promise<void> {
    const state = await Promise.race([
      reader.read().then(() => "resolved"),
      new Promise<"pending">((resolve) => {
        setTimeout(() => resolve("pending"), timeoutMs);
      })
    ]);

    expect(state).toBe("pending");
  }

  it("T1 POST initialize returns InitializeResult and Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { response, sessionId } = await fixture.initialize();
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(200);
    expect(sessionId).toBe("session-1");
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true }
        },
        serverInfo: { name: "http-test", version: "1.0.0" }
      }
    });
  });

  it("rejects array params as an invalid HTTP request", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: "http-array",
      method: "ping",
      params: []
    });

    expect(response.status).toBe(400);
    expect(await readJsonRpcBody(response)).toEqual({
      jsonrpc: "2.0",
      id: "http-array",
      error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request" }
    });
  });

  it("negotiates the supported protocol version for unsupported requests", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "not-a-supported-version" }
    });

    expect(await readJsonRpcBody(response)).toMatchObject({
      result: { protocolVersion: "2025-11-25" }
    });
  });

  it("T2 POST initialized notification returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const initialized = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const sessionId = initialized.headers.get("mcp-session-id");
    const response = await fixture.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("does not create sessions from notification-form initialize messages", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-notify"
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("does not process ordinary session requests before initialized acknowledgement", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const initializeResponse = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(await readJsonRpcBody(response)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32600, message: "Session not initialized" }
    });
  });

  it("does not emit notifications before initialized acknowledgement", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const initializeResponse = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id") ?? undefined;
    const response = await fixture.get({ sessionId });
    const reader = response.body!.getReader();

    await fixture.server.notifyToolsChanged();

    await expectReaderToStayOpen(reader);
    await reader.cancel();
  });

  it("accepts post-initialize requests without a protocol version header", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const initializeResponse = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id") ?? undefined;
    await fixture.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId });

    const postResponse = await fixture.request(
      "POST",
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "Mcp-Session-Id": sessionId ?? ""
        }
      }
    );
    expect(postResponse.status).toBe(200);

    const getResponse = await fixture.request("GET", undefined, {
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId ?? ""
      }
    });
    expect(getResponse.status).toBe(200);
    await getResponse.body?.cancel();

    const deleteResponse = await fixture.request("DELETE", undefined, {
      headers: { "Mcp-Session-Id": sessionId ?? "" }
    });
    expect(deleteResponse.status).toBe(204);
  });

  it("rejects a conflicting protocol version on post-initialize requests", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const initializeResponse = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id") ?? undefined;
    await fixture.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId });

    const headers = {
      "Mcp-Session-Id": sessionId ?? "",
      "MCP-Protocol-Version": "2099-99-99"
    };
    const postResponse = await fixture.request(
      "POST",
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...headers
        }
      }
    );
    const getResponse = await fixture.request("GET", undefined, {
      headers: { Accept: "text/event-stream", ...headers }
    });
    const deleteResponse = await fixture.request("DELETE", undefined, {
      headers
    });

    expect(postResponse.status).toBe(400);
    expect(getResponse.status).toBe(400);
    expect(deleteResponse.status).toBe(400);

    const validDeleteResponse = await fixture.request("DELETE", undefined, {
      headers: { "Mcp-Session-Id": sessionId ?? "" }
    });
    expect(validDeleteResponse.status).toBe(204);
  });

  it("does not process ordinary methods before initialize in a new session batch", async () => {
    let nextId = 0;
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => `session-${++nextId}`
    });

    await fixture.initialize();
    const response = await fixture.post([
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-03-26" } }
    ]);

    expect(await readJsonRpcBody(response)).toMatchObject([
      { id: 2, error: { code: -32600, message: "Session not initialized" } },
      { id: 3, result: { protocolVersion: "2025-03-26" } }
    ]);
  });

  it("T3 POST tools/list returns the tool list", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );
    const body = (await readJsonRpcBody(response)) as {
      result: { tools: Array<{ name: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["echo", "explode"]);
  });

  it("T4 POST tools/call returns the tool result", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } }
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [{ type: "text", text: "hello" }]
      }
    });
  });

  it("T5 POST JSON-RPC response returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 9, result: { ok: true } },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("T6 enableJsonResponse true returns application/json", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("T7 enableJsonResponse false returns text/event-stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("rejects SSE POST responses when the client accepts only JSON", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: undefined
    });

    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" }
      },
      { headers: { Accept: "application/json" } }
    );

    expect(response.status).toBe(406);
  });

  it("T8 SSE POST body contains data lines", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );
    const body = await response.text();

    expect(body).toContain("data: ");
    expect(body).toContain('"id":2');
  });

  it("T9 SSE POST stream ends after the response is sent", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
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

  it("T10 batch of 3 requests returns 3 responses", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "batch" } }
        }
      ],
      { sessionId: sessionId ?? undefined }
    );
    const body = (await readJsonRpcBody(response)) as Array<{ id: number }>;

    expect(response.status).toBe(200);
    expect(body.map((entry) => entry.id)).toEqual([2, 3, 4]);
  });

  it("returns valid batch results alongside invalid member errors", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    const response = await fixture.post([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      17,
      { jsonrpc: "2.0", id: 2, method: "ping" }
    ]);
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(200);
    expect(body).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 2, result: {} }
    ]);
  });

  it("T11 batch of notifications returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/initialized" }
      ],
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("T12 mixed batch returns responses only for requests", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" }
      ],
      { sessionId: sessionId ?? undefined }
    );
    const body = (await readJsonRpcBody(response)) as Array<{ id: number }>;

    expect(response.status).toBe(200);
    expect(body.map((entry) => entry.id)).toEqual([2, 3]);
  });

  it("T13 batch SSE contains all responses", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" }
      ],
      { sessionId: sessionId ?? undefined }
    );
    const body = await response.text();

    expect(countOccurrences(body, "data: ")).toBe(2);
    expect(body).toContain('"id":2');
    expect(body).toContain('"id":3');
  });

  it("T14 POST without session after init returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    await fixture.initialize();
    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });

    expect(response.status).toBe(400);
  });

  it("T15 POST with a valid session is accepted", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(200);
  });

  it("T16 POST with an invalid session returns 404", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: "missing-session" }
    );

    expect(response.status).toBe(404);
  });

  it("T17 initialize does not require a session", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { response, sessionId } = await fixture.initialize();

    expect(response.status).toBe(200);
    expect(sessionId).toBe("session-1");
  });

  it("T18 invalid JSON body returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post('{"jsonrpc":"2.0"', {
      headers: { "Content-Type": "application/json" }
    });
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    });
  });

  it("T19 empty body returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post("", {
      headers: { "Content-Type": "application/json" }
    });
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    });
  });

  it("T20 non-JSON content-type returns 415", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { headers: { "Content-Type": "text/plain" } }
    );
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" }
    });
  });

  it("rejects POST requests without a JSON content type", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    const response = await fixture.request(
      "POST",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" }
      },
      { headers: { Accept: "application/json" } }
    );

    expect(response.status).toBe(415);
  });

  it("T21 unknown method returns JSON-RPC METHOD_NOT_FOUND", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "missing/method" },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found" }
    });
  });

  it("T22 throwing tool returns an isError result", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "explode", arguments: {} }
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "Error: boom" }],
        isError: true
      }
    });
  });

  it("T23 missing tool returns JSON-RPC INVALID_PARAMS", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "missing", arguments: {} }
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        message: "Tool not found: missing. Available: echo, explode"
      }
    });
  });

  it("T24 tools/call before initialize returns server not initialized", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } }
    });
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32600, message: "Server not initialized" }
    });
  });

  it("T25 initialize response includes Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { response } = await fixture.initialize();

    expect(response.headers.get("mcp-session-id")).toBe("session-1");
  });

  it("rejects generated session identifiers that cannot be emitted in headers", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "bad\nheader"
    });

    const { response, sessionId } = await fixture.initialize();

    expect(response.status).toBe(500);
    expect(sessionId).toBeNull();
  });

  it("rejects generated session identifier collisions", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "shared-session"
    });

    const first = await fixture.initialize();
    const second = await fixture.initialize();

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(500);
    expect(second.sessionId).toBeNull();
  });

  it("T26 subsequent responses include the same Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.headers.get("mcp-session-id")).toBe("session-1");
  });

  it("T27 stateless mode omits Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize"
    });

    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("T28 GET returns text/event-stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("rejects GET streams when Accept does not include text/event-stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({
      sessionId: sessionId ?? undefined,
      headers: { Accept: "application/json" }
    });

    expect(response.status).toBe(406);
  });

  it("T29 GET without session returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.get();

    expect(response.status).toBe(400);
  });

  it("T30 GET with valid session keeps the stream open", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();
    await expectReaderToStayOpen(reader!);
  });

  it("sends unref'd keepalive comments and clears the interval on close", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      const fixture = await createFixture({
        enableJsonResponse: true,
        sessionIdGenerator: () => "session-1"
      });

      const { sessionId } = await fixture.initialize();
      const response = await fixture.get({ sessionId: sessionId ?? undefined });
      const reader = response.body!.getReader();
      const keepaliveIndex = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 30_000);
      const interval = setIntervalSpy.mock.results[keepaliveIndex]?.value as NodeJS.Timeout;

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
      expect(interval.hasRef()).toBe(false);

      const event = readSseEvent(reader);
      vi.advanceTimersByTime(30_000);

      await expect(event).resolves.toBe(": keepalive\n\n");

      await fixture.transport.close();

      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one keepalive interval and clears it after the last GET stream closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      const fixture = await createFixture({
        enableJsonResponse: true,
        sessionIdGenerator: () => "session-1",
        maxStreamsPerSession: 2
      });

      const { sessionId } = await fixture.initialize();
      const firstAbortController = new AbortController();
      const secondAbortController = new AbortController();
      await fixture.get({
        sessionId: sessionId ?? undefined,
        signal: firstAbortController.signal
      });
      await fixture.get({
        sessionId: sessionId ?? undefined,
        signal: secondAbortController.signal
      });
      const keepaliveIndex = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 30_000);
      const interval = setIntervalSpy.mock.results[keepaliveIndex]?.value as NodeJS.Timeout;

      expect(setIntervalSpy.mock.calls.map(([, delay]) => delay)).toEqual([60_000, 30_000]);

      firstAbortController.abort();
      await vi.waitFor(() => expect(clearIntervalSpy).not.toHaveBeenCalled());

      secondAbortController.abort();
      await vi.waitFor(() => expect(clearIntervalSpy).toHaveBeenCalledWith(interval));
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured keepalive interval and restarts after all GET streams close", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    try {
      const fixture = await createFixture({
        enableJsonResponse: true,
        sessionIdGenerator: () => "session-1",
        sseKeepAliveMs: 5_000
      });

      const { sessionId } = await fixture.initialize();
      const firstAbortController = new AbortController();
      await fixture.get({
        sessionId: sessionId ?? undefined,
        signal: firstAbortController.signal
      });

      expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 5_000);

      firstAbortController.abort();
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));

      const secondResponse = await fixture.get({ sessionId: sessionId ?? undefined });

      expect(setIntervalSpy.mock.calls.map(([, delay]) => delay)).toEqual([60_000, 5_000, 5_000]);
      expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 5_000);

      await secondResponse.body!.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule keepalives for POST SSE responses or disabled GET streams", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    try {
      const postFixture = await createFixture({
        sessionIdGenerator: () => "post-session"
      });
      await postFixture.initialize();

      expect(setIntervalSpy.mock.calls.map(([, delay]) => delay)).toEqual([60_000]);

      const disabledFixture = await createFixture({
        enableJsonResponse: true,
        sessionIdGenerator: () => "disabled-session",
        sseKeepAliveMs: 0
      });
      const { sessionId } = await disabledFixture.initialize();
      const response = await disabledFixture.get({ sessionId: sessionId ?? undefined });

      expect(setIntervalSpy.mock.calls.map(([, delay]) => delay)).toEqual([60_000, 60_000]);

      await response.body!.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("T31 notifyToolsChanged sends an event on the GET stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });
    const reader = response.body!.getReader();

    await fixture.server.notifyToolsChanged();

    const event = await readSseEvent(reader);

    expect(event).toContain("id: ");
    expect(event).toContain("data: ");
    expect(event).toContain("notifications/tools/list_changed");
  });

  it("T32 GET stream closes when the transport closes", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });
    const reader = response.body!.getReader();

    await fixture.transport.close();

    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("T33 GET in stateless mode returns 405", async () => {
    const fixture = await createFixture({ sessionIdGenerator: undefined });

    const response = await fixture.get();

    expect(response.status).toBe(405);
  });

  it("T34 DELETE with a valid session returns 204", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.delete({ sessionId: sessionId ?? undefined });

    expect(response.status).toBe(204);
  });

  it("T35 DELETE invalidates the session", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1"
    });

    const { sessionId } = await fixture.initialize();

    await fixture.delete({ sessionId: sessionId ?? undefined });

    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(404);
  });

  it("T36 DELETE without a session returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.delete();

    expect(response.status).toBe(400);
  });

  it("T37 DELETE with an unknown session returns 404", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.delete({ sessionId: "missing-session" });

    expect(response.status).toBe(404);
  });

  it("T38 DELETE in stateless mode returns 405", async () => {
    const fixture = await createFixture({ sessionIdGenerator: undefined });

    const response = await fixture.delete();

    expect(response.status).toBe(405);
  });

  it("T39 PUT returns 405", async () => {
    const fixture = await createFixture();

    const response = await fixture.request("PUT");

    expect(response.status).toBe(405);
  });

  it("T40 PATCH returns 405", async () => {
    const fixture = await createFixture();

    const response = await fixture.request("PATCH");

    expect(response.status).toBe(405);
  });

  it("T41 OPTIONS returns CORS preflight response", async () => {
    const fixture = await createFixture();

    const response = await fixture.request("OPTIONS");

    expect(response.status).toBe(204);
  });

  it.each([
    ["POST", { jsonrpc: "2.0", id: 1, method: "initialize" }, 415],
    ["GET", undefined, 400],
    ["DELETE", undefined, 400],
    ["OPTIONS", undefined, 204],
    ["PUT", undefined, 405]
  ] as const)("adds Vary: Origin to %s responses", async (method, body, status) => {
    const fixture = await createFixture();

    const response = await fixture.request(method, body);

    expect(response.status).toBe(status);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects negative transport limits at construction time", () => {
    const server = createServer({ name: "http-test", version: "1.0.0" });

    expect(() => new StreamableHttpTransport(server, { maxRequestBytes: -1 })).toThrow(
      "maxRequestBytes must be an integer greater than or equal to 1."
    );
    expect(() => new StreamableHttpTransport(server, { maxBatchSize: -1 })).toThrow(
      "maxBatchSize must be an integer greater than or equal to 1."
    );
    expect(() => new StreamableHttpTransport(server, { maxSessions: -1 })).toThrow(
      "maxSessions must be an integer greater than or equal to 1."
    );
    expect(() => new StreamableHttpTransport(server, { maxStreamBufferBytes: -1 })).toThrow(
      "maxStreamBufferBytes must be an integer greater than or equal to 0."
    );
    expect(() => new StreamableHttpTransport(server, { maxStreamBufferBytes: 1.5 })).toThrow(
      "maxStreamBufferBytes must be an integer greater than or equal to 0."
    );
    expect(() => new StreamableHttpTransport(server, { sseKeepAliveMs: -1 })).toThrow(
      "sseKeepAliveMs must be an integer greater than or equal to 0."
    );
    expect(() => new StreamableHttpTransport(server, { sseKeepAliveMs: 1.5 })).toThrow(
      "sseKeepAliveMs must be an integer greater than or equal to 0."
    );
  });
});

// ---------------------------------------------------------------------------
// express-middleware.test.ts
// ---------------------------------------------------------------------------

describe("createExpressMiddleware", () => {
  const registeredCleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...registeredCleanups].reverse()) {
      await cleanup();
    }
    registeredCleanups.clear();
  });

  interface ExpressHandle {
    baseUrl: string;
    close(): Promise<void>;
  }

  function trackCleanup(cleanup: () => Promise<void>): void {
    registeredCleanups.add(async () => {
      registeredCleanups.delete(cleanup);
      await cleanup();
    });
  }

  async function listenExpressApp(configure: (app: Express) => void): Promise<ExpressHandle> {
    const app = express();
    configure(app);
    const server = http.createServer(app);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected Express app to bind to a TCP port");
    }

    const { port } = address as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }

            resolve();
          });

          server.closeIdleConnections?.();
          server.closeAllConnections?.();
        });
      }
    };
  }

  async function connectSdkClient(url: string): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
    cleanup: () => Promise<void>;
  }> {
    const client = new Client({ name: "sdk-express-test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: nodeFetch
    });

    await client.connect(transport);

    return {
      client,
      transport,
      cleanup: async () => {
        await client.close();
      }
    };
  }

  async function postJsonRpc(
    url: string,
    message: unknown,
    options: {
      headers?: HeadersInit;
      sessionId?: string;
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

    return nodeFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message)
    });
  }

  async function deleteSession(
    url: string,
    options: { headers?: HeadersInit; sessionId?: string } = {}
  ): Promise<Response> {
    const headers = new Headers(options.headers);

    if (options.sessionId !== undefined) {
      headers.set("Mcp-Session-Id", options.sessionId);
      headers.set("MCP-Protocol-Version", TEST_PROTOCOL_VERSION);
    }

    return nodeFetch(url, {
      method: "DELETE",
      headers
    });
  }

  async function initializeSession(
    url: string,
    headers?: HeadersInit
  ): Promise<{ response: Response; sessionId: string | null }> {
    const response = await postJsonRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      { headers }
    );
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null) {
      await postJsonRpc(
        url,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId, headers }
      );
    }

    return {
      response,
      sessionId
    };
  }

  function createNamedServer(
    name: string,
    toolName: string,
    transform: (text: string) => string
  ): HttpServer {
    return createHttpServer({ name, version: "1.0.0" }).tool(
      toolName,
      `${name} echo`,
      defineSchema({ text: { type: "string" } }),
      ({ text }) => transform(String(text))
    );
  }

  it("E1 initializes and lists tools through the SDK client via Express", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const client = await connectSdkClient(`${handle.baseUrl}/mcp`);
    trackCleanup(client.cleanup);

    expect(client.client.getServerVersion()).toEqual({
      name: "conformance-test-server",
      version: "1.0.0"
    });

    const tools = await client.client.listTools();

    expect(tools.tools.some((tool) => tool.name === "echo")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "large_output")).toBe(true);
  });

  it("E2 calls a tool through the SDK client via Express", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const client = await connectSdkClient(`${handle.baseUrl}/mcp`);
    trackCleanup(client.cleanup);

    const result = await client.client.callTool({
      name: "echo",
      arguments: { text: "hello from express" }
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "hello from express" }]
    });
  });

  it("E3 accepts POST requests on the mounted path", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const response = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    expect(response.status).toBe(200);
    await expect(readJsonRpcPayload(response)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: TEST_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true }
        },
        serverInfo: { name: "conformance-test-server", version: "1.0.0" }
      }
    });
  });

  it("E4 leaves non-MCP routes untouched", async () => {
    const handle = await listenExpressApp((app) => {
      app.get("/health", (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("E5 serves the GET SSE stream through Express", async () => {
    const server = createTestMcpServer();
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(server));
    });
    trackCleanup(handle.close);

    const { sessionId } = await initializeSession(`${handle.baseUrl}/mcp`);
    expect(sessionId).toBeTruthy();

    const response = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId ?? "",
        "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
      }
    });
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    await server.notifyToolsChanged();

    const event = await readSseEvent(reader!);
    expect(event).toContain("notifications/tools/list_changed");

    await reader?.cancel();
  });

  it("E6 deletes sessions through Express", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const { sessionId } = await initializeSession(`${handle.baseUrl}/mcp`);
    expect(sessionId).toBeTruthy();

    const deleteResponse = await deleteSession(`${handle.baseUrl}/mcp`, {
      sessionId: sessionId ?? undefined
    });
    const postDeleteResponse = await postJsonRpc(
      `${handle.baseUrl}/mcp`,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(deleteResponse.status).toBe(204);
    expect(postDeleteResponse.status).toBe(404);
  });

  it("E7 supports auth middleware before the MCP route", async () => {
    const auth: RequestHandler = (req, res, next) => {
      if (req.header("authorization") !== "Bearer secret-token") {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      next();
    };

    const handle = await listenExpressApp((app) => {
      app.use("/mcp", auth, createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const unauthorized = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });
    const authorized = await postJsonRpc(
      `${handle.baseUrl}/mcp`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      },
      {
        headers: {
          Authorization: "Bearer secret-token"
        }
      }
    );

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
  });

  it("E8 forwards request errors to the Express error handler", async () => {
    const server = createTestMcpServer();
    vi.spyOn(server, "handleRequest").mockRejectedValue(new Error("adapter boom"));

    const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(500).json({
        message: error instanceof Error ? error.message : String(error)
      });
    };

    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(server));
      app.use(errorHandler);
    });
    trackCleanup(handle.close);

    const response = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ message: "adapter boom" });
  });

  it("E9 works with express.json() pre-parsed bodies", async () => {
    const handle = await listenExpressApp((app) => {
      app.use(express.json());
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const { sessionId } = await initializeSession(`${handle.baseUrl}/mcp`);
    const response = await postJsonRpc(
      `${handle.baseUrl}/mcp`,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: { text: "parsed by express" }
        }
      },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(200);
    await expect(readJsonRpcPayload(response)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "parsed by express" }]
      }
    });
  });

  it("E10 works from a nested mount path", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/api/v1/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const client = await connectSdkClient(`${handle.baseUrl}/api/v1/mcp`);
    trackCleanup(client.cleanup);

    const tools = await client.client.listTools();

    expect(tools.tools.some((tool) => tool.name === "reverse")).toBe(true);
  });

  it("E11 supports multiple MCP servers on different paths", async () => {
    const alphaServer = createNamedServer("alpha-server", "alpha_echo", (text) => `alpha:${text}`);
    const betaServer = createNamedServer("beta-server", "beta_echo", (text) => `beta:${text}`);
    const handle = await listenExpressApp((app) => {
      app.use("/mcp-alpha", createExpressMiddleware(alphaServer));
      app.use("/mcp-beta", createExpressMiddleware(betaServer));
    });
    trackCleanup(handle.close);

    const alphaClient = await connectSdkClient(`${handle.baseUrl}/mcp-alpha`);
    const betaClient = await connectSdkClient(`${handle.baseUrl}/mcp-beta`);
    trackCleanup(alphaClient.cleanup);
    trackCleanup(betaClient.cleanup);

    const [alphaTools, betaTools, alphaResult, betaResult] = await Promise.all([
      alphaClient.client.listTools(),
      betaClient.client.listTools(),
      alphaClient.client.callTool({
        name: "alpha_echo",
        arguments: { text: "one" }
      }),
      betaClient.client.callTool({
        name: "beta_echo",
        arguments: { text: "two" }
      })
    ]);

    expect(alphaTools.tools.map((tool) => tool.name)).toEqual(["alpha_echo"]);
    expect(betaTools.tools.map((tool) => tool.name)).toEqual(["beta_echo"]);
    expect(alphaResult.content).toEqual([{ type: "text", text: "alpha:one" }]);
    expect(betaResult.content).toEqual([{ type: "text", text: "beta:two" }]);
  });

  it("E12 supports stateless mode through Express", async () => {
    const handle = await listenExpressApp((app) => {
      app.use(
        "/mcp",
        createExpressMiddleware(
          createTestMcpServer({
            sessionIdGenerator: undefined
          })
        )
      );
    });
    trackCleanup(handle.close);

    const initializeResponse = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });
    const callResponse = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "stateless express" } }
    });

    expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();
    expect(callResponse.status).toBe(200);
    await expect(readJsonRpcPayload(callResponse)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "stateless express" }]
      }
    });
  });
});

// ---------------------------------------------------------------------------
// http-server.test.ts
// ---------------------------------------------------------------------------

describe("HttpServer integration", () => {
  const require = createRequire(import.meta.url);
  const tinyClientAvailable = (() => {
    try {
      require.resolve("tiny-mcp-client");
      return true;
    } catch {
      return false;
    }
  })();

  const registeredCleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of registeredCleanups) {
      await cleanup();
    }
    registeredCleanups.clear();
  });

  function trackCleanup(cleanup: () => Promise<void>): void {
    registeredCleanups.add(async () => {
      registeredCleanups.delete(cleanup);
      await cleanup();
    });
  }

  async function reservePort(): Promise<{
    port: number;
    release: () => Promise<void>;
  }> {
    const server = http.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an AddressInfo result");
    }

    const { port } = address;

    return {
      port,
      release: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    };
  }

  async function supportsIpv6Loopback(): Promise<boolean> {
    const server = http.createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "::1", () => resolve());
      });

      return true;
    } catch {
      return false;
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }
    }
  }

  async function connectSdkClient(url: string): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
    cleanup: () => Promise<void>;
  }> {
    const client = new Client({ name: "sdk-http-test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: nodeFetch
    });

    await client.connect(transport);

    return {
      client,
      transport,
      cleanup: async () => {
        await client.close();
      }
    };
  }

  async function postJsonRpc(
    url: string,
    message: unknown,
    options: { sessionId?: string } = {}
  ): Promise<Response> {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    });

    if (options.sessionId !== undefined) {
      headers.set("Mcp-Session-Id", options.sessionId);
      headers.set("MCP-Protocol-Version", TEST_PROTOCOL_VERSION);
    }

    return nodeFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message)
    });
  }

  describe("SDK client integration", () => {
    it("I1 initializes and lists tools through the SDK client", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      expect(pair.client.getServerVersion()).toEqual({
        name: "conformance-test-server",
        version: "1.0.0"
      });

      const tools = await pair.client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "echo",
        "reverse",
        "uppercase",
        "get_user",
        "get_list",
        "get_image",
        "get_audio",
        "get_file",
        "get_mixed",
        "throw_sync",
        "throw_async",
        "empty_result",
        "slow",
        "large_output"
      ]);
    });

    it("I2 calls a text tool through the SDK client", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "echo",
        arguments: { text: "hello over HTTP" }
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "hello over HTTP" }]
      });
    });

    it("I3 returns structured data as JSON text content", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_user",
        arguments: { id: "user-7" }
      });

      expect(result.content).toEqual([
        {
          type: "text",
          text: '{"id":"user-7","name":"Alice","role":"admin"}'
        }
      ]);
    });

    it("I4 propagates tool failures as MCP error results", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "throw_async",
        arguments: {}
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Error: async boom" }]);
    });

    it("I5 receives tool list change notifications over GET SSE", async () => {
      const server = createTestMcpServer();
      const pair = await createHttpTestPair(server);
      trackCleanup(pair.cleanup);

      const received = new Promise<void>((resolve) => {
        pair.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          resolve();
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      await server.notifyToolsChanged();
      await received;
    });

    it("I6 terminates the SDK session via DELETE", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const sessionId = pair.transport.sessionId;
      expect(sessionId).toBeDefined();

      await pair.transport.terminateSession();

      const response = await postJsonRpc(
        pair.url,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { sessionId }
      );

      expect(response.status).toBe(404);
    });

    it("I7 reconnects after a 404 when the original session expires", async () => {
      const server = createTestMcpServer();
      const pair = await createHttpTestPair(server);
      trackCleanup(pair.cleanup);

      const expiredSessionId = pair.transport.sessionId;
      if (expiredSessionId === undefined) {
        throw new Error("Expected SDK transport to expose a session id");
      }

      const deleteResponse = await nodeFetch(pair.url, {
        method: "DELETE",
        headers: {
          "Mcp-Session-Id": expiredSessionId,
          "MCP-Protocol-Version": pair.transport.protocolVersion ?? TEST_PROTOCOL_VERSION
        }
      });
      expect(deleteResponse.status).toBe(204);

      await expect(pair.client.listTools()).rejects.toThrow();

      const secondClient = await connectSdkClient(pair.url);
      trackCleanup(secondClient.cleanup);

      const tools = await secondClient.client.listTools();

      expect(tools.tools.some((tool) => tool.name === "echo")).toBe(true);
      expect(secondClient.transport.sessionId).not.toBe(expiredSessionId);
    });

    it("I8 lists and calls multiple tools through one SDK client", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const tools = await pair.client.listTools();
      const reverseResult = await pair.client.callTool({
        name: "reverse",
        arguments: { text: "desserts" }
      });
      const uppercaseResult = await pair.client.callTool({
        name: "uppercase",
        arguments: { text: "mcp" }
      });

      expect(tools.tools.some((tool) => tool.name === "reverse")).toBe(true);
      expect(reverseResult.content).toEqual([{ type: "text", text: "stressed" }]);
      expect(uppercaseResult.content).toEqual([{ type: "text", text: "MCP" }]);
    });
  });

  const tinyDescribe = tinyClientAvailable ? describe : describe.skip;

  tinyDescribe("tiny-mcp-client integration", () => {
    it("I9 connects and initializes a tiny-mcp-client transport", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());

      trackCleanup(pair.cleanup);

      await vi.waitFor(() => {
        const postMethods = pair.requests
          .filter((request) => request.method === "POST")
          .map((request) => request.jsonRpcMethod);

        expect(postMethods).toContain("initialize");
        expect(postMethods).toContain("notifications/initialized");
      });

      await vi.waitFor(() => {
        expect(
          pair.requests.some((request) => request.method === "GET" && request.sessionId !== null)
        ).toBe(true);
      });
    });

    it("I10 lists tools with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());

      trackCleanup(pair.cleanup);

      const tools = await pair.client.listTools();

      expect(tools.tools.some((tool) => tool.name === "echo")).toBe(true);
      expect(tools.tools.some((tool) => tool.name === "get_mixed")).toBe(true);
    });

    it("I11 calls a tool with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());

      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "reverse",
        arguments: { text: "drawer" }
      });

      expect(result.content).toEqual([{ type: "text", text: "reward" }]);
    });

    it("I12 receives SSE POST responses with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());

      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "slow",
        arguments: {}
      });

      expect(result.content).toEqual([{ type: "text", text: "done" }]);
      expect(
        pair.requests.some(
          (request) =>
            request.method === "POST" &&
            request.jsonRpcMethod === "tools/call" &&
            request.responseContentType?.includes("text/event-stream") === true
        )
      ).toBe(true);
    });

    it("I13 sends DELETE when the tiny-mcp-client transport is disposed", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());

      trackCleanup(pair.cleanup);

      await pair.client.close();

      await vi.waitFor(() => {
        expect(pair.requests.some((request) => request.method === "DELETE")).toBe(true);
      });
    });
  });

  describe("listenHttp convenience", () => {
    it("I14 starts the server on a specified port", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const reservation = await reservePort();

        try {
          await reservation.release();

          const handle = await createTestMcpServer().listenHttp({
            port: reservation.port
          });
          trackCleanup(handle.close);

          const response = await postJsonRpc(handle.url, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: TEST_PROTOCOL_VERSION }
          });

          expect(handle.port).toBe(reservation.port);
          expect(response.status).toBe(200);
          return;
        } catch (error) {
          if (!hasOwnErrorCode(error, "EADDRINUSE") || attempt === 4) {
            throw error;
          }
        }
      }
    });

    it("I15 uses a random port when port 0 is requested", async () => {
      const handle = await createTestMcpServer().listenHttp({ port: 0 });
      trackCleanup(handle.close);

      expect(handle.port).toBeGreaterThan(0);
    });

    it("I16 returns the full MCP endpoint URL", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);
    });

    it("I17 handle.close shuts the server down", async () => {
      const handle = await createTestMcpServer().listenHttp();

      await handle.close();

      await expect(
        postJsonRpc(handle.url, {
          jsonrpc: "2.0",
          id: 1,
          method: "ping"
        })
      ).rejects.toThrow();
    });

    it("I18 respects AbortSignal shutdown", async () => {
      const controller = new AbortController();
      const handle = await createTestMcpServer().listenHttp({
        signal: controller.signal
      });

      controller.abort();

      await vi.waitFor(async () => {
        await expect(
          postJsonRpc(handle.url, {
            jsonrpc: "2.0",
            id: 1,
            method: "ping"
          })
        ).rejects.toThrow();
      });
    });

    it("I19 supports a custom endpoint path", async () => {
      const handle = await createTestMcpServer().listenHttp({
        path: "/api/v1/mcp"
      });
      trackCleanup(handle.close);

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });

      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/api/v1/mcp`);
      expect(response.status).toBe(200);
    });

    it("I20 defaults to 127.0.0.1", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      expect(new URL(handle.url).hostname).toBe("127.0.0.1");
    });

    it("I21 returns a usable bracketed URL for IPv6 loopback listeners", async () => {
      if (!(await supportsIpv6Loopback())) {
        return;
      }

      const handle = await createTestMcpServer().listenHttp({
        hostname: "::1"
      });
      trackCleanup(handle.close);

      expect(handle.url).toBe(`http://[::1]:${handle.port}/mcp`);

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });

      expect(response.status).toBe(200);
    });

    it("I22 returns 404 for non-MCP paths", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(`http://127.0.0.1:${handle.port}/health`);

      expect(response.status).toBe(404);
    });
  });

  describe("Stateless mode", () => {
    it("I23 omits Mcp-Session-Id headers in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();
      trackCleanup(handle.close);

      const initializeResponse = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });
      const toolsResponse = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list"
      });

      expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();
      expect(toolsResponse.headers.get("mcp-session-id")).toBeNull();
    });

    it("I24 accepts requests without session headers in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();
      trackCleanup(handle.close);

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "stateless" } }
      });

      expect(response.status).toBe(200);
      await expect(readJsonRpcPayload(response)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: "stateless" }]
        }
      });
    });

    it("I25 rejects DELETE in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(handle.url, { method: "DELETE" });

      expect(response.status).toBe(405);
    });

    it("I26 rejects GET in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(handle.url, {
        method: "GET",
        headers: { Accept: "text/event-stream" }
      });

      expect(response.status).toBe(405);
    });
  });

  describe("Multiple clients and concurrency", () => {
    it("I27 supports two SDK clients with independent sessions", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      const first = await connectSdkClient(handle.url);
      const second = await connectSdkClient(handle.url);
      trackCleanup(first.cleanup);
      trackCleanup(second.cleanup);

      const [firstTools, secondTools] = await Promise.all([
        first.client.listTools(),
        second.client.listTools()
      ]);

      expect(first.transport.sessionId).toBeDefined();
      expect(second.transport.sessionId).toBeDefined();
      expect(first.transport.sessionId).not.toBe(second.transport.sessionId);
      expect(firstTools.tools).toHaveLength(secondTools.tools.length);
    });

    it("I28 handles concurrent tool calls on the same session", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const [echoResult, upperResult] = await Promise.all([
        pair.client.callTool({
          name: "echo",
          arguments: { text: "parallel-a" }
        }),
        pair.client.callTool({
          name: "uppercase",
          arguments: { text: "parallel-b" }
        })
      ]);

      expect(echoResult.content).toEqual([{ type: "text", text: "parallel-a" }]);
      expect(upperResult.content).toEqual([{ type: "text", text: "PARALLEL-B" }]);
    });

    it("I29 keeps sessions isolated when one client deletes its own session", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      const first = await connectSdkClient(handle.url);
      const second = await connectSdkClient(handle.url);
      trackCleanup(first.cleanup);
      trackCleanup(second.cleanup);

      const deletedSessionId = first.transport.sessionId;
      if (deletedSessionId === undefined) {
        throw new Error("Expected a session id for the first SDK client");
      }

      await first.transport.terminateSession();

      const secondTools = await second.client.listTools();
      const deletedSessionResponse = await postJsonRpc(
        handle.url,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { sessionId: deletedSessionId }
      );

      expect(secondTools.tools.some((tool) => tool.name === "echo")).toBe(true);
      expect(deletedSessionResponse.status).toBe(404);
    });
  });

  describe("Edge cases", () => {
    it("I30 handles a 100KB+ JSON-RPC request body", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();
      trackCleanup(handle.close);

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });

      const largeText = "x".repeat(120_000);
      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: largeText } }
      });
      const payload = (await readJsonRpcPayload(response)) as {
        result: { content: Array<{ text: string }> };
      };

      expect(response.status).toBe(200);
      expect(payload.result.content[0].text).toHaveLength(120_000);
    });

    it("I31 survives rapid connect and disconnect cycles", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      for (let index = 0; index < 5; index += 1) {
        const client = await connectSdkClient(handle.url);
        await client.client.listTools();
        await client.cleanup();
      }

      const finalClient = await connectSdkClient(handle.url);
      trackCleanup(finalClient.cleanup);

      const tools = await finalClient.client.listTools();

      expect(tools.tools.some((tool) => tool.name === "large_output")).toBe(true);
    });

    it("I32 closes cleanly while a request is in flight", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined
      }).listenHttp();

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION }
      });

      const requestPromise = postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "slow", arguments: {} }
      });

      await handle.close();

      const [requestResult] = await Promise.allSettled([requestPromise]);
      expect(requestResult.status === "fulfilled" || requestResult.status === "rejected").toBe(
        true
      );
    });

    it("I33 transmits image content blocks correctly", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_image",
        arguments: {}
      });

      expect(result.content).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png"
        }
      ]);
    });

    it("I34 transmits multiple mixed content blocks correctly", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_mixed",
        arguments: {}
      });

      expect(result.content).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png"
        },
        {
          type: "text",
          text: "Caption for the image"
        },
        {
          type: "resource",
          resource: {
            uri: "file:///data",
            mimeType: "text/plain",
            text: "notes"
          }
        }
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// cli.test.ts
// ---------------------------------------------------------------------------

describe("tiny-http-mcp-server CLI", () => {
  const initializeRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "tiny-http-cli-test",
        version: "1.0.0"
      }
    }
  };

  interface CapturedOutput {
    readonly stdout: string;
    readonly stderr: string;
    readonly io: {
      stdout: { write: (chunk: string | Uint8Array) => boolean };
      stderr: { write: (chunk: string | Uint8Array) => boolean };
    };
  }

  function createCapturedOutput(): CapturedOutput {
    let stdout = "";
    let stderr = "";

    const append = (chunk: string | Uint8Array): string =>
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    return {
      get stdout() {
        return stdout;
      },
      get stderr() {
        return stderr;
      },
      io: {
        stdout: {
          write: (chunk) => {
            stdout += append(chunk);
            return true;
          }
        },
        stderr: {
          write: (chunk) => {
            stderr += append(chunk);
            return true;
          }
        }
      }
    };
  }

  async function withStartedCli(
    args: string[],
    verify: (url: URL) => Promise<void>
  ): Promise<{ exitCode: number; output: CapturedOutput }> {
    const output = createCapturedOutput();
    const exitCode = await runCli(args, {
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      waitForShutdown: async (shutdown) => {
        const url = new URL(output.stdout.trim());

        try {
          await verify(url);
        } finally {
          await shutdown();
        }
      }
    });

    if (exitCode !== 0) {
      throw new Error(
        output.stderr.trim().length > 0 ? output.stderr.trim() : output.stdout.trim()
      );
    }

    return { exitCode, output };
  }

  async function postInitialize(url: URL): Promise<Response> {
    return nodeFetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(1_000),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(initializeRequest)
    });
  }

  it("C1 starts server on default port 3000", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:3000/mcp",
      port: 3000,
      close
    });
    const createServer = vi.fn(() => ({ listenHttp }));
    const output = createCapturedOutput();

    const exitCode = await runCli([], {
      createServer,
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      waitForShutdown: async (shutdown) => {
        await shutdown();
      }
    });

    expect(exitCode).toBe(0);
    expect(listenHttp).toHaveBeenCalledWith({
      port: 3000,
      hostname: "127.0.0.1",
      path: "/mcp"
    });
    expect(output.stdout).toBe("http://127.0.0.1:3000/mcp\n");
  });

  it("C2 --port 0 picks random port", async () => {
    const { exitCode } = await withStartedCli(["--port", "0"], async (url) => {
      expect(Number(url.port)).toBeGreaterThan(0);

      const response = await postInitialize(url);

      expect(response.status).toBe(200);
      await response.text();
    });

    expect(exitCode).toBe(0);
  });

  it("C3 --hostname 127.0.0.1 binds correctly", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--hostname", "127.0.0.1"],
      async (url) => {
        expect(url.hostname).toBe("127.0.0.1");

        const response = await postInitialize(url);

        expect(response.status).toBe(200);
        await response.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C4 --path /api/mcp uses custom path", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--path", "/api/mcp"],
      async (url) => {
        expect(url.pathname).toBe("/api/mcp");

        const customPathResponse = await postInitialize(url);
        const defaultPathResponse = await postInitialize(new URL("/mcp", url));

        expect(customPathResponse.status).toBe(200);
        expect(defaultPathResponse.status).toBe(404);
        await customPathResponse.text();
        await defaultPathResponse.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C5 --stateless disables sessions", async () => {
    const { exitCode } = await withStartedCli(["--port", "0", "--stateless"], async (url) => {
      const response = await postInitialize(url);

      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      await response.text();
    });

    expect(exitCode).toBe(0);
  });

  it("C6 --json-response returns JSON content-type", async () => {
    const { exitCode } = await withStartedCli(["--port", "0", "--json-response"], async (url) => {
      const response = await postInitialize(url);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      await response.text();
    });

    expect(exitCode).toBe(0);
  });

  it("C7 enables OAuth mode when --oauth-resource is configured", async () => {
    const verifier = {
      verify: vi.fn(async () => {
        throw new Error("not used in this test");
      })
    };
    const createServer = vi.fn(() => ({
      listenHttp: vi.fn().mockResolvedValue({
        url: "http://127.0.0.1:3000/mcp",
        port: 3000,
        close: vi.fn().mockResolvedValue(undefined)
      })
    }));
    const loadOAuthVerifier = vi.fn(async () => verifier);

    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-authorization-server",
        "https://auth.example.com",
        "--oauth-verifier-module",
        "./verify-token.mjs"
      ],
      {
        createServer,
        loadOAuthVerifier,
        stdout: createCapturedOutput().io.stdout,
        waitForShutdown: async (shutdown) => {
          await shutdown();
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(loadOAuthVerifier).toHaveBeenCalledWith({
      modulePath: "./verify-token.mjs",
      exportName: "default"
    });
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: {
          resource: "https://resource.example.com/mcp",
          authorizationServers: ["https://auth.example.com/"],
          verifier
        }
      })
    );
  });

  it("C8 parses repeatable OAuth scope and bearer flags", async () => {
    const createServer = vi.fn(() => ({
      listenHttp: vi.fn().mockResolvedValue({
        url: "http://127.0.0.1:3000/mcp",
        port: 3000,
        close: vi.fn().mockResolvedValue(undefined)
      })
    }));

    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-authorization-server",
        "https://auth-a.example.com",
        "--oauth-authorization-server",
        "https://auth-b.example.com",
        "--oauth-supported-scope",
        "mcp.read",
        "--oauth-supported-scope",
        "mcp.write",
        "--oauth-required-scope",
        "mcp.read",
        "--oauth-required-scope",
        "mcp.admin",
        "--oauth-bearer-method",
        " header ",
        "--oauth-bearer-method",
        "body",
        "--oauth-verifier-module",
        "./verify-token.mjs"
      ],
      {
        createServer,
        loadOAuthVerifier: async () => ({
          verify: vi.fn(async () => {
            throw new Error("not used in this test");
          })
        }),
        stdout: createCapturedOutput().io.stdout,
        waitForShutdown: async (shutdown) => {
          await shutdown();
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: expect.objectContaining({
          authorizationServers: ["https://auth-a.example.com/", "https://auth-b.example.com/"],
          scopesSupported: ["mcp.read", "mcp.write"],
          requiredScopes: ["mcp.read", "mcp.admin"],
          bearerMethodsSupported: ["header", "body"]
        })
      })
    );
  });

  it("exits with code 1 for non-decimal numeric flags", async () => {
    const cases = [
      ["--port", "0x50"],
      ["--max-batch-size", "1e3"],
      ["--max-sessions-per-subject", "1e3"],
      ["--max-stream-buffer-bytes", "1e3"],
      ["--sse-keep-alive-ms", "1e3"],
      ["--request-timeout-ms", "0x100"]
    ];

    for (const args of cases) {
      const createServer = vi.fn();
      const output = createCapturedOutput();

      const exitCode = await runCli(args, {
        createServer,
        stdout: output.io.stdout,
        stderr: output.io.stderr
      });

      expect(exitCode).toBe(1);
      expect(createServer).not.toHaveBeenCalled();
      expect(output.stderr).toContain("must be an integer");
    }
  });

  it("exits with code 1 for blank repeatable OAuth flags", async () => {
    const cases = [
      ["--oauth-supported-scope", "   "],
      ["--oauth-required-scope", ""],
      ["--oauth-bearer-method", "  "]
    ];

    for (const repeatedFlag of cases) {
      const createServer = vi.fn();
      const output = createCapturedOutput();

      const exitCode = await runCli(
        [
          "--oauth-resource",
          "https://resource.example.com/mcp",
          "--oauth-authorization-server",
          "https://auth.example.com",
          ...repeatedFlag,
          "--oauth-verifier-module",
          "./verify-token.mjs"
        ],
        {
          createServer,
          loadOAuthVerifier: async () => ({
            verify: vi.fn(async () => {
              throw new Error("not used in this test");
            })
          }),
          stdout: output.io.stdout,
          stderr: output.io.stderr
        }
      );

      expect(exitCode).toBe(1);
      expect(createServer).not.toHaveBeenCalled();
      expect(output.stderr).toContain(`${repeatedFlag[0]} must not be blank`);
    }
  });

  it("C9 passes --oauth-verifier-export to the verifier loader", async () => {
    const createServer = vi.fn(() => ({
      listenHttp: vi.fn().mockResolvedValue({
        url: "http://127.0.0.1:3000/mcp",
        port: 3000,
        close: vi.fn().mockResolvedValue(undefined)
      })
    }));
    const loadOAuthVerifier = vi.fn(async () => ({
      verify: vi.fn(async () => {
        throw new Error("not used in this test");
      })
    }));

    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-authorization-server",
        "https://auth.example.com",
        "--oauth-verifier-module",
        "./verify-token.mjs",
        "--oauth-verifier-export",
        "customVerifier"
      ],
      {
        createServer,
        loadOAuthVerifier,
        stdout: createCapturedOutput().io.stdout,
        waitForShutdown: async (shutdown) => {
          await shutdown();
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(loadOAuthVerifier).toHaveBeenCalledWith({
      modulePath: "./verify-token.mjs",
      exportName: "customVerifier"
    });
  });

  it("parses production hardening flags into server and listen options", async () => {
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:3000/mcp",
      port: 3000,
      close: vi.fn().mockResolvedValue(undefined)
    });
    const createServer = vi.fn(() => ({ listenHttp }));

    const exitCode = await runCli(
      [
        "--allowed-host",
        "mcp.example.com",
        "--allowed-origin",
        "https://client.example.com/app",
        "--max-request-bytes",
        "1024",
        "--max-batch-size",
        "8",
        "--max-sessions",
        "100",
        "--max-sessions-per-subject",
        "12",
        "--session-ttl-ms",
        "60000",
        "--max-streams-per-session",
        "2",
        "--max-stream-buffer-bytes",
        "2048",
        "--max-sse-event-history",
        "10",
        "--sse-keep-alive-ms",
        "15000",
        "--max-concurrent-tool-calls",
        "4",
        "--trusted-proxy",
        "--request-timeout-ms",
        "30000",
        "--headers-timeout-ms",
        "5000",
        "--keep-alive-timeout-ms",
        "1000"
      ],
      {
        createServer,
        stdout: createCapturedOutput().io.stdout,
        waitForShutdown: async (shutdown) => {
          await shutdown();
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedHosts: ["mcp.example.com"],
        allowedOrigins: ["https://client.example.com"],
        maxRequestBytes: 1024,
        maxBatchSize: 8,
        maxSessions: 100,
        maxSessionsPerSubject: 12,
        sessionTtlMs: 60_000,
        maxStreamsPerSession: 2,
        maxStreamBufferBytes: 2048,
        maxSseEventHistory: 10,
        sseKeepAliveMs: 15_000,
        maxConcurrentToolCalls: 4,
        trustedProxy: true
      })
    );
    expect(listenHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        requestTimeoutMs: 30_000,
        headersTimeoutMs: 5_000,
        keepAliveTimeoutMs: 1_000
      })
    );
  });

  it("C10 -h/--help shows help and exits with code 0", async () => {
    const createServer = vi.fn();
    const shortOutput = createCapturedOutput();
    const longOutput = createCapturedOutput();

    const shortExitCode = await runCli(["-h"], {
      createServer,
      stdout: shortOutput.io.stdout,
      stderr: shortOutput.io.stderr
    });
    const longExitCode = await runCli(["--help"], {
      createServer,
      stdout: longOutput.io.stdout,
      stderr: longOutput.io.stderr
    });

    expect(shortExitCode).toBe(0);
    expect(longExitCode).toBe(0);
    expect(createServer).not.toHaveBeenCalled();
    expect(shortOutput.stdout).toContain("Usage: tiny-http-mcp-server [options]");
    expect(shortOutput.stdout).toContain("--json-response");
    expect(shortOutput.stdout).toContain("--allowed-host");
    expect(shortOutput.stdout).toContain("--max-request-bytes");
    expect(shortOutput.stdout).toContain("--max-stream-buffer-bytes");
    expect(shortOutput.stdout).toContain("--sse-keep-alive-ms");
    expect(shortOutput.stdout).toContain("--trusted-proxy");
    expect(shortOutput.stdout).toContain("--request-timeout-ms");
    expect(shortOutput.stdout).toContain("--oauth-resource");
    expect(shortOutput.stdout).toContain("--oauth-authorization-server");
    expect(shortOutput.stdout).toContain("--oauth-supported-scope");
    expect(shortOutput.stdout).toContain("--oauth-required-scope");
    expect(shortOutput.stdout).toContain("--oauth-bearer-method");
    expect(shortOutput.stdout).toContain("--oauth-verifier-module");
    expect(shortOutput.stdout).toContain("--oauth-verifier-export");
    expect(shortOutput.stdout).toContain("--shutdown-grace-ms");
    expect(shortOutput.stdout).toContain("--version");
    expect(longOutput.stdout).toContain("-h, --help");
  });

  it("prints the package version and exits with code 0", async () => {
    const createServer = vi.fn();
    const output = createCapturedOutput();

    const exitCode = await runCli(["--version"], {
      createServer,
      stdout: output.io.stdout,
      stderr: output.io.stderr
    });

    expect(exitCode).toBe(0);
    expect(createServer).not.toHaveBeenCalled();
    expect(output.stdout).toBe("0.1.0\n");
    expect(output.stderr).toBe("");
  });

  it("appends a help hint to argument-parse failures", async () => {
    const output = createCapturedOutput();

    const exitCode = await runCli(["--port", "invalid"], {
      stdout: output.io.stdout,
      stderr: output.io.stderr
    });

    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--port must be an integer.");
    expect(output.stderr.endsWith("Run with --help for usage.\n")).toBe(true);
  });

  it("rejects a negative shutdown grace period with the help hint", async () => {
    const output = createCapturedOutput();

    const exitCode = await runCli(["--shutdown-grace-ms=-1"], {
      stdout: output.io.stdout,
      stderr: output.io.stderr
    });

    expect(exitCode).toBe(1);
    expect(output.stderr).toBe(
      "--shutdown-grace-ms must be an integer.\nRun with --help for usage.\n"
    );
  });

  it("C11 SIGINT triggers graceful shutdown", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41000/mcp",
      port: 41000,
      close,
      closeAllConnections: vi.fn()
    });
    const createServer = vi.fn(() => ({ listenHttp }));
    const output = createCapturedOutput();
    const runPromise = runCli(["--port", "0"], {
      createServer,
      stdout: output.io.stdout,
      stderr: output.io.stderr
    });

    await vi.waitFor(() => {
      expect(output.stdout).toBe("http://127.0.0.1:41000/mcp\n");
    });
    process.emit("SIGINT", "SIGINT");

    await expect(runPromise).resolves.toBe(0);
    expect(close).toHaveBeenCalledOnce();
    expect(output.stderr).toBe("");
  });

  it("force-closes hung connections after the shutdown grace period", async () => {
    let signalHandler = () => undefined;
    let graceHandler = () => undefined;
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const closeAllConnections = vi.fn();
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41000/mcp",
      port: 41000,
      close,
      closeAllConnections
    });
    const output = createCapturedOutput();
    const runPromise = runCli(["--shutdown-grace-ms", "25"], {
      createServer: vi.fn(() => ({ listenHttp })),
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      listenForShutdownSignals: (handler) => {
        signalHandler = handler;
        return vi.fn();
      },
      scheduleShutdownGrace: (handler, graceMs) => {
        expect(graceMs).toBe(25);
        graceHandler = handler;
        return vi.fn();
      }
    });

    await vi.waitFor(() => expect(output.stdout).toContain("http://127.0.0.1:41000/mcp"));
    signalHandler();
    expect(close).toHaveBeenCalledOnce();
    graceHandler();

    await expect(runPromise).resolves.toBe(1);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("cancels forced shutdown when graceful shutdown completes", async () => {
    let signalHandler = () => undefined;
    const cancelGrace = vi.fn();
    const removeSignalListeners = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const closeAllConnections = vi.fn();
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41000/mcp",
      port: 41000,
      close,
      closeAllConnections
    });
    const output = createCapturedOutput();
    const runPromise = runCli([], {
      createServer: vi.fn(() => ({ listenHttp })),
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      listenForShutdownSignals: (handler) => {
        signalHandler = handler;
        return removeSignalListeners;
      },
      scheduleShutdownGrace: () => cancelGrace
    });

    await vi.waitFor(() => expect(output.stdout).toContain("http://127.0.0.1:41000/mcp"));
    signalHandler();

    await expect(runPromise).resolves.toBe(0);
    expect(close).toHaveBeenCalledOnce();
    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(cancelGrace).toHaveBeenCalledOnce();
    expect(removeSignalListeners).toHaveBeenCalledOnce();
  });

  it("force-closes hung connections immediately on a second shutdown signal", async () => {
    let signalHandler = () => undefined;
    const cancelGrace = vi.fn();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const closeAllConnections = vi.fn();
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41000/mcp",
      port: 41000,
      close,
      closeAllConnections
    });
    const output = createCapturedOutput();
    const runPromise = runCli([], {
      createServer: vi.fn(() => ({ listenHttp })),
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      listenForShutdownSignals: (handler) => {
        signalHandler = handler;
        return vi.fn();
      },
      scheduleShutdownGrace: (_handler, graceMs) => {
        expect(graceMs).toBe(10_000);
        return cancelGrace;
      }
    });

    await vi.waitFor(() => expect(output.stdout).toContain("http://127.0.0.1:41000/mcp"));
    signalHandler();
    signalHandler();

    await expect(runPromise).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(cancelGrace).toHaveBeenCalledOnce();
  });

  it("force-closes connections when graceful shutdown rejects", async () => {
    let signalHandler = () => undefined;
    const cancelGrace = vi.fn();
    const removeSignalListeners = vi.fn();
    const close = vi.fn().mockRejectedValue(new Error("shutdown failed"));
    const closeAllConnections = vi.fn();
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41000/mcp",
      port: 41000,
      close,
      closeAllConnections
    });
    const output = createCapturedOutput();
    const runPromise = runCli([], {
      createServer: vi.fn(() => ({ listenHttp })),
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      listenForShutdownSignals: (handler) => {
        signalHandler = handler;
        return removeSignalListeners;
      },
      scheduleShutdownGrace: () => cancelGrace
    });

    await vi.waitFor(() => expect(output.stdout).toContain("http://127.0.0.1:41000/mcp"));
    signalHandler();

    await expect(runPromise).resolves.toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(cancelGrace).toHaveBeenCalledOnce();
    expect(removeSignalListeners).toHaveBeenCalledOnce();
    expect(output.stderr).toBe("shutdown failed\n");
  });

  it("C12 exits with code 1 when --oauth-resource is set without --oauth-authorization-server", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-verifier-module",
        "./verify-token.mjs"
      ],
      { stdout: output.io.stdout, stderr: output.io.stderr }
    );
    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--oauth-authorization-server");
  });

  it("C13 exits with code 1 when --oauth-resource is set without --oauth-verifier-module", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-authorization-server",
        "https://auth.example.com"
      ],
      { stdout: output.io.stdout, stderr: output.io.stderr }
    );
    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--oauth-verifier-module");
  });

  it("C14 exits with code 1 when an OAuth flag is set without --oauth-resource", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["--oauth-authorization-server", "https://auth.example.com"], {
      stdout: output.io.stdout,
      stderr: output.io.stderr
    });
    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--oauth-resource");
  });

  it("C15 exits with code 1 when --oauth-resource is not an absolute URL", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(
      [
        "--oauth-resource",
        "not-a-url",
        "--oauth-authorization-server",
        "https://auth.example.com",
        "--oauth-verifier-module",
        "./verify-token.mjs"
      ],
      { stdout: output.io.stdout, stderr: output.io.stderr }
    );
    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--oauth-resource");
  });

  it("C16 exits with code 1 when --oauth-authorization-server is not an absolute URL", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(
      [
        "--oauth-resource",
        "https://resource.example.com/mcp",
        "--oauth-authorization-server",
        "not-a-url",
        "--oauth-verifier-module",
        "./verify-token.mjs"
      ],
      { stdout: output.io.stdout, stderr: output.io.stderr }
    );
    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("--oauth-authorization-server");
  });
});

// ---------------------------------------------------------------------------
// spec-conformance.test.ts
// ---------------------------------------------------------------------------

describe("Spec conformance", () => {
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
    currentProtocolVersion(): string;
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
      }
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
        responseSessionId: response.headers.get("mcp-session-id")
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
      ...options.headers
    });

    if (options.sessionId !== undefined) {
      headers.set("Mcp-Session-Id", options.sessionId);
      headers.set("MCP-Protocol-Version", TEST_PROTOCOL_VERSION);
    }

    return nodeFetch(url, {
      method: "POST",
      headers,
      body: typeof message === "string" ? message : JSON.stringify(message)
    });
  }

  async function openGetStream(url: string, sessionId: string): Promise<Response> {
    return nodeFetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": TEST_PROTOCOL_VERSION
      }
    });
  }

  async function deleteSession(
    url: string,
    sessionId?: string,
    protocolVersion = TEST_PROTOCOL_VERSION
  ): Promise<Response> {
    const headers = new Headers();

    if (sessionId !== undefined) {
      headers.set("Mcp-Session-Id", sessionId);
      headers.set("MCP-Protocol-Version", protocolVersion);
    }

    return nodeFetch(url, {
      method: "DELETE",
      headers
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
      params: { protocolVersion: TEST_PROTOCOL_VERSION }
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null) {
      await postJsonRpc(
        url,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId }
      );
    }

    return {
      response,
      sessionId
    };
  }

  async function expectNoSseEvent(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs = 20
  ): Promise<void> {
    const state = await Promise.race([
      reader.read().then(() => "resolved"),
      new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeoutMs);
      })
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

      if (
        typeof request.bodyJson !== "object" ||
        request.bodyJson === null ||
        Array.isArray(request.bodyJson)
      ) {
        return false;
      }

      return (request.bodyJson as { method?: unknown }).method === jsonRpcMethod;
    });
  }

  function getTextBlock(result: { content: Array<Record<string, unknown>> }): {
    type: string;
    text: string;
  } {
    const first = result.content[0] as { type?: unknown; text?: unknown };

    return {
      type: String(first.type),
      text: String(first.text)
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
      fetch: createLoggedFetch(requests)
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
        close: () => client.close()
      },
      url,
      requests,
      currentSessionId: () => transport.sessionId,
      currentProtocolVersion: () => transport.protocolVersion ?? TEST_PROTOCOL_VERSION,
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
      }
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
      }
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
      })
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
        close: () => client.close()
      },
      url,
      requests,
      currentSessionId: () => currentSessionId,
      currentProtocolVersion: () => TEST_PROTOCOL_VERSION,
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
      }
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
        server.tool(
          "typed_profile",
          "Return a typed profile",
          defineSchema({ id: { type: "string" } }),
          ({ id }) => ({
            id,
            displayName: "Alice"
          }),
          {
            type: "object",
            properties: {
              id: { type: "string" },
              displayName: { type: "string" }
            },
            required: ["id", "displayName"],
            additionalProperties: false
          }
        );
        server.tool(
          "invalid_typed_profile",
          "Return an invalid typed profile",
          emptySchema,
          () => ({ id: 7 }),
          {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
            additionalProperties: false
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
              { jsonrpc: "2.0", id: 3, method: "tools/list" }
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
              { jsonrpc: "2.0", method: "notifications/initialized" }
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
              { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Method not found" } }
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
            enableJsonResponse: true
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
                  params: { name: "notify_during_call", arguments: {} }
                },
                { sessionId: sessionId ?? undefined }
              )
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
            sessionIdGenerator: undefined
          }).listenHttp({ port: 0 });
          trackCleanup(handle.close);

          const response = await nodeFetch(handle.url, {
            method: "GET",
            headers: { Accept: "text/event-stream" }
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
            method: "tools/list"
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

          const deleteResponse = await deleteSession(
            pair.url,
            expiredSessionId,
            pair.currentProtocolVersion()
          );

          expect(deleteResponse.status).toBe(204);
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
            sessionIdGenerator: undefined
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
            arguments: { text: "hello" }
          });

          expect(result.content).toEqual([{ type: "text", text: "hello" }]);
        });

        it("SC31: structured JSON results round-trip", async () => {
          const result = await pair.client.callTool({
            name: "get_user",
            arguments: { id: "user-7" }
          });
          const textBlock = getTextBlock(result);

          expect(textBlock.type).toBe("text");
          expect(JSON.parse(textBlock.text)).toEqual({
            id: "user-7",
            name: "Alice",
            role: "admin"
          });
        });

        it("SC31a: typed structured results advertise output schemas and include fallback text", async () => {
          const list = await pair.client.listTools();
          expect(list.tools).toContainEqual(
            expect.objectContaining({
              name: "typed_profile",
              outputSchema: expect.objectContaining({
                type: "object",
                properties: expect.objectContaining({
                  displayName: { type: "string" }
                })
              })
            })
          );

          const result = (await pair.client.callTool({
            name: "typed_profile",
            arguments: { id: "user-7" }
          })) as {
            content: Array<{ type: string; text: string }>;
            structuredContent?: Record<string, unknown>;
          };

          expect(result.structuredContent).toEqual({
            id: "user-7",
            displayName: "Alice"
          });
          expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
        });

        it("SC31b: invalid typed outputs return JSON-RPC internal errors", async () => {
          await expect(
            pair.client.callTool({
              name: "invalid_typed_profile",
              arguments: {}
            })
          ).rejects.toMatchObject({ code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR });
        });

        it("SC32: image content round-trips", async () => {
          const result = await pair.client.callTool({
            name: "get_image",
            arguments: {}
          });

          expect(result.content).toEqual([
            {
              type: "image",
              data: TEST_PNG_BASE64,
              mimeType: "image/png"
            }
          ]);
        });

        it("SC33: audio content round-trips", async () => {
          const result = await pair.client.callTool({
            name: "get_audio",
            arguments: {}
          });

          expect(result.content).toEqual([
            {
              type: "audio",
              data: TEST_MP3_BASE64,
              mimeType: "audio/mpeg"
            }
          ]);
        });

        it("SC34: file content round-trips", async () => {
          const result = await pair.client.callTool({
            name: "get_file",
            arguments: {}
          });

          expect(result.content).toEqual([
            {
              type: "resource",
              resource: {
                uri: "file:///data",
                mimeType: "text/csv",
                text: "hello,world"
              }
            }
          ]);
        });

        it("SC35: mixed content round-trips", async () => {
          const result = await pair.client.callTool({
            name: "get_mixed",
            arguments: {}
          });

          expect(result.content).toEqual([
            {
              type: "image",
              data: TEST_PNG_BASE64,
              mimeType: "image/png"
            },
            {
              type: "text",
              text: "Caption for the image"
            },
            {
              type: "resource",
              resource: {
                uri: "file:///data",
                mimeType: "text/plain",
                text: "notes"
              }
            }
          ]);
        });

        it("SC36: undefined results round-trip as an empty content array", async () => {
          const result = await pair.client.callTool({
            name: "empty_result",
            arguments: {}
          });

          expect(result.content).toEqual([]);
        });

        it("SC37: large outputs round-trip without truncation", async () => {
          const result = await pair.client.callTool({
            name: "large_output",
            arguments: {}
          });
          const textBlock = getTextBlock(result);

          expect(textBlock.text).toHaveLength(100_000);
        });
      });

      describe("Error Handling", () => {
        it("SC38: synchronous tool throws become isError results", async () => {
          const result = await pair.client.callTool({
            name: "throw_sync",
            arguments: {}
          });
          const textBlock = getTextBlock(result);

          expect(result.isError).toBe(true);
          expect(textBlock.text).toBe("Error: sync boom");
        });

        it("SC39: asynchronous tool throws become isError results", async () => {
          const result = await pair.client.callTool({
            name: "throw_async",
            arguments: {}
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
              params: { name: "missing", arguments: {} }
            },
            { sessionId: sessionId ?? undefined }
          );

          expect(await readJsonRpcPayload(response)).toEqual({
            jsonrpc: "2.0",
            id: 2,
            error: {
              code: -32602,
              message:
                "Tool not found: missing. Available: echo, reverse, uppercase, get_user, get_list, get_image, get_audio, get_file, get_mixed, throw_sync, throw_async, empty_result, slow, large_output, notify_during_call, typed_profile, invalid_typed_profile"
            }
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
            error: { code: -32601, message: "Method not found" }
          });
        });

        it("SC42: invalid JSON bodies return 400", async () => {
          const response = await postJsonRpc(pair.url, '{"jsonrpc":"2.0"', {
            headers: { "Content-Type": "application/json" }
          });

          expect(response.status).toBe(400);
          expect(await readJsonRpcPayload(response)).toEqual({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" }
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
            expect(
              findRequestByMethod(pair.requests, "POST", "notifications/initialized")
            ).toBeDefined();
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
                params: { name: "echo", arguments: { text: "batch" } }
              }
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
              { jsonrpc: "2.0", id: 3, method: "tools/list" }
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
            sibling.client.listTools()
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
              arguments: { text: "parallel-a" }
            }),
            pair.client.callTool({
              name: "uppercase",
              arguments: { text: "parallel-b" }
            })
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
});
