import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, defineSchema } from "tiny-stdio-mcp-server";
import { StreamableHttpTransport } from "./http-transport.js";

interface FixtureOptions {
  enableJsonResponse?: boolean;
  sessionIdGenerator?: (() => string) | undefined;
}

interface Fixture {
  server: ReturnType<typeof createServer>;
  transport: StreamableHttpTransport;
  url: string;
  close(): Promise<void>;
  request(
    method: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<TestResponse>;
  post(body: unknown, options?: RequestOptions): Promise<TestResponse>;
  get(options?: RequestOptions): Promise<TestResponse>;
  delete(options?: RequestOptions): Promise<TestResponse>;
  initialize(): Promise<{ response: TestResponse; sessionId: string | null }>;
}

interface RequestOptions {
  sessionId?: string;
  headers?: Record<string, string>;
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
    .tool(
      "echo",
      "Echo text",
      defineSchema({ text: { type: "string" } }),
      ({ text }) => String(text)
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
      ...requestOptions.headers,
    };

    if (requestOptions.sessionId !== undefined) {
      headers["Mcp-Session-Id"] = requestOptions.sessionId;
    }

    let payload: string | undefined;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }

    return new Promise<TestResponse>((resolve, reject) => {
      const request = http.request(
        url,
        {
          method,
          headers,
        },
        (response) => {
          const responseHeaders = new Headers();

          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") {
              responseHeaders.set(key, value);
              continue;
            }

            if (Array.isArray(value)) {
              responseHeaders.set(key, value.join(", "));
            }
          }

          const stream = Readable.toWeb(response) as ReadableStream<Uint8Array>;

          resolve({
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            body: stream,
            async text() {
              const decoder = new TextDecoder();
              const reader = stream.getReader();
              let text = "";

              while (true) {
                const chunk = await reader.read();

                if (chunk.done) {
                  break;
                }

                text += decoder.decode(chunk.value, { stream: true });
              }

              return text + decoder.decode();
            },
          });
        }
      );

      request.on("error", reject);

      if (payload !== undefined) {
        request.write(payload);
      }

      request.end();
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
          ...requestOptions.headers,
        },
      });
    },
    async get(requestOptions = {}) {
      return sendRequest("GET", undefined, {
        ...requestOptions,
        headers: {
          Accept: "text/event-stream",
          ...requestOptions.headers,
        },
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
        params: { protocolVersion: "2025-03-26" },
      });

      return {
        response,
        sessionId: response.headers.get("mcp-session-id"),
      };
    },
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

async function expectReaderToStayOpen(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 50
): Promise<void> {
  const state = await Promise.race([
    reader.read().then(() => "resolved"),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), timeoutMs);
    }),
  ]);

  expect(state).toBe("pending");
}

describe("StreamableHttpTransport", () => {
  it("T1 POST initialize returns InitializeResult and Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "http-test", version: "1.0.0" },
      },
    });
  });

  it("T2 POST initialized notification returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("T3 POST tools/list returns the tool list", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "explode",
    ]);
  });

  it("T4 POST tools/call returns the tool result", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } },
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("T5 POST JSON-RPC response returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("T8 SSE POST body contains data lines", async () => {
    const fixture = await createFixture({
      enableJsonResponse: false,
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
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
          params: { name: "echo", arguments: { text: "batch" } },
        },
      ],
      { sessionId: sessionId ?? undefined }
    );
    const body = (await readJsonRpcBody(response)) as Array<{ id: number }>;

    expect(response.status).toBe(200);
    expect(body.map((entry) => entry.id)).toEqual([2, 3, 4]);
  });

  it("T11 batch of notifications returns 202", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ],
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("T12 mixed batch returns responses only for requests", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
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
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      [
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
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
      method: "tools/list",
    });

    expect(response.status).toBe(400);
  });

  it("T15 POST with a valid session is accepted", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
    });

    const { response, sessionId } = await fixture.initialize();

    expect(response.status).toBe(200);
    expect(sessionId).toBe("session-1");
  });

  it("T18 invalid JSON body returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post('{"jsonrpc":"2.0"', {
      headers: { "Content-Type": "application/json" },
    });
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("T19 empty body returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post("", {
      headers: { "Content-Type": "application/json" },
    });
    const body = await readJsonRpcBody(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("T20 non-JSON content-type returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.post(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { headers: { "Content-Type": "text/plain" } }
    );

    expect(response.status).toBe(400);
  });

  it("T21 unknown method returns JSON-RPC METHOD_NOT_FOUND", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("T22 throwing tool returns an isError result", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "explode", arguments: {} },
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "Error: boom" }],
        isError: true,
      },
    });
  });

  it("T23 missing tool returns JSON-RPC INVALID_PARAMS", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "missing", arguments: {} },
      },
      { sessionId: sessionId ?? undefined }
    );
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32602, message: "Tool not found: missing" },
    });
  });

  it("T24 tools/call before initialize returns server not initialized", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });
    const body = await readJsonRpcBody(response);

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32600, message: "Server not initialized" },
    });
  });

  it("T25 initialize response includes Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { response } = await fixture.initialize();

    expect(response.headers.get("mcp-session-id")).toBe("session-1");
  });

  it("T26 subsequent responses include the same Mcp-Session-Id", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: undefined,
    });

    const response = await fixture.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("T28 GET returns text/event-stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("T29 GET without session returns 400", async () => {
    const fixture = await createFixture({ enableJsonResponse: true });

    const response = await fixture.get();

    expect(response.status).toBe(400);
  });

  it("T30 GET with valid session keeps the stream open", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();
    await expectReaderToStayOpen(reader!);
  });

  it("T31 notifyToolsChanged sends an event on the GET stream", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.get({ sessionId: sessionId ?? undefined });
    const reader = response.body!.getReader();

    await fixture.server.notifyToolsChanged();

    const event = await readSseEvent(reader);

    expect(event).toContain("data: ");
    expect(event).toContain("notifications/tools/list_changed");
  });

  it("T32 GET stream closes when the transport closes", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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
      sessionIdGenerator: () => "session-1",
    });

    const { sessionId } = await fixture.initialize();
    const response = await fixture.delete({ sessionId: sessionId ?? undefined });

    expect(response.status).toBe(204);
  });

  it("T35 DELETE invalidates the session", async () => {
    const fixture = await createFixture({
      enableJsonResponse: true,
      sessionIdGenerator: () => "session-1",
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

  it("T41 OPTIONS returns 405", async () => {
    const fixture = await createFixture();

    const response = await fixture.request("OPTIONS");

    expect(response.status).toBe(405);
  });
});
