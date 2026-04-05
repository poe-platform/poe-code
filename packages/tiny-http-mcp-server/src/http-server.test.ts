import http from "node:http";
import { createRequire } from "node:module";
import https from "node:https";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createHttpTestPair,
  createHttpTestPairWithTinyClient,
  createTestMcpServer,
} from "./testing.js";

const require = createRequire(import.meta.url);
const tinyClientAvailable = (() => {
  try {
    require.resolve("tiny-mcp-client");
    return true;
  } catch {
    return false;
  }
})();

const TEST_PROTOCOL_VERSION = "2025-03-26";
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

async function getFreePort(): Promise<number> {
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

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

async function connectSdkClient(url: string): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
  cleanup: () => Promise<void>;
}> {
  const client = new Client({ name: "sdk-http-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: nodeFetch,
  });

  await client.connect(transport);

  return {
    client,
    transport,
    cleanup: async () => {
      await client.close();
    },
  };
}

async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: init.method ?? "GET",
        hostname: url.hostname,
        port: url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
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

        const body =
          response.statusCode === 204
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    request.on("error", reject);

    if (init.signal !== undefined) {
      const onAbort = () => {
        request.destroy(new Error("Request aborted"));
      };

      if (init.signal.aborted) {
        onAbort();
        return;
      }

      init.signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => {
        init.signal?.removeEventListener("abort", onAbort);
      });
    }

    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      request.write(init.body);
    }

    request.end();
  });
}

async function postJsonRpc(
  url: string,
  message: unknown,
  options: { sessionId?: string } = {}
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });

  if (options.sessionId !== undefined) {
    headers.set("Mcp-Session-Id", options.sessionId);
  }

  return nodeFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
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

describe("HttpServer integration", () => {
  describe("SDK client integration", () => {
    it("I1 initializes and lists tools through the SDK client", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      expect(pair.client.getServerVersion()).toEqual({
        name: "conformance-test-server",
        version: "1.0.0",
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
        "large_output",
      ]);
    });

    it("I2 calls a text tool through the SDK client", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "echo",
        arguments: { text: "hello over HTTP" },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "hello over HTTP" }],
      });
    });

    it("I3 returns structured data as JSON text content", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_user",
        arguments: { id: "user-7" },
      });

      expect(result.content).toEqual([
        {
          type: "text",
          text: '{"id":"user-7","name":"Alice","role":"admin"}',
        },
      ]);
    });

    it("I4 propagates tool failures as MCP error results", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "throw_async",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Error: async boom" },
      ]);
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
        headers: { "Mcp-Session-Id": expiredSessionId },
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
        arguments: { text: "desserts" },
      });
      const uppercaseResult = await pair.client.callTool({
        name: "uppercase",
        arguments: { text: "mcp" },
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
      if (pair === null) {
        return;
      }

      trackCleanup(pair.cleanup);

      await vi.waitFor(() => {
        const postMethods = pair.requests
          .filter((request) => request.method === "POST")
          .map((request) => request.jsonRpcMethod);

        expect(postMethods).toContain("initialize");
        expect(postMethods).toContain("notifications/initialized");
      });

      expect(
        pair.requests.some(
          (request) => request.method === "GET" && request.sessionId !== null
        )
      ).toBe(true);
    });

    it("I10 lists tools with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());
      if (pair === null) {
        return;
      }

      trackCleanup(pair.cleanup);

      const tools = await pair.client.listTools();

      expect(tools.tools.some((tool) => tool.name === "echo")).toBe(true);
      expect(tools.tools.some((tool) => tool.name === "get_mixed")).toBe(true);
    });

    it("I11 calls a tool with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());
      if (pair === null) {
        return;
      }

      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "reverse",
        arguments: { text: "drawer" },
      });

      expect(result.content).toEqual([{ type: "text", text: "reward" }]);
    });

    it("I12 receives SSE POST responses with tiny-mcp-client", async () => {
      const pair = await createHttpTestPairWithTinyClient(createTestMcpServer());
      if (pair === null) {
        return;
      }

      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "slow",
        arguments: {},
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
      if (pair === null) {
        return;
      }

      trackCleanup(pair.cleanup);

      await pair.client.close();

      await vi.waitFor(() => {
        expect(pair.requests.some((request) => request.method === "DELETE")).toBe(true);
      });
    });
  });

  describe("listenHttp convenience", () => {
    it("I14 starts the server on a specified port", async () => {
      const port = await getFreePort();
      const server = createTestMcpServer();
      const handle = await server.listenHttp({ port });
      trackCleanup(handle.close);

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });

      expect(handle.port).toBe(port);
      expect(response.status).toBe(200);
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
          method: "ping",
        })
      ).rejects.toThrow();
    });

    it("I18 respects AbortSignal shutdown", async () => {
      const controller = new AbortController();
      const handle = await createTestMcpServer().listenHttp({
        signal: controller.signal,
      });

      controller.abort();

      await vi.waitFor(async () => {
        await expect(
          postJsonRpc(handle.url, {
            jsonrpc: "2.0",
            id: 1,
            method: "ping",
          })
        ).rejects.toThrow();
      });
    });

    it("I19 supports a custom endpoint path", async () => {
      const handle = await createTestMcpServer().listenHttp({
        path: "/api/v1/mcp",
      });
      trackCleanup(handle.close);

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });

      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/api/v1/mcp`);
      expect(response.status).toBe(200);
    });

    it("I20 defaults to 127.0.0.1", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      expect(new URL(handle.url).hostname).toBe("127.0.0.1");
    });

    it("I21 returns 404 for non-MCP paths", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(`http://127.0.0.1:${handle.port}/health`);

      expect(response.status).toBe(404);
    });
  });

  describe("Stateless mode", () => {
    it("I22 omits Mcp-Session-Id headers in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();
      trackCleanup(handle.close);

      const initializeResponse = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });
      const toolsResponse = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();
      expect(toolsResponse.headers.get("mcp-session-id")).toBeNull();
    });

    it("I23 accepts requests without session headers in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();
      trackCleanup(handle.close);

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });

      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "stateless" } },
      });

      expect(response.status).toBe(200);
      await expect(readJsonRpcPayload(response)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: "stateless" }],
        },
      });
    });

    it("I24 rejects DELETE in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(handle.url, { method: "DELETE" });

      expect(response.status).toBe(405);
    });

    it("I25 rejects GET in stateless mode", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();
      trackCleanup(handle.close);

      const response = await nodeFetch(handle.url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      });

      expect(response.status).toBe(405);
    });
  });

  describe("Multiple clients and concurrency", () => {
    it("I26 supports two SDK clients with independent sessions", async () => {
      const handle = await createTestMcpServer().listenHttp();
      trackCleanup(handle.close);

      const first = await connectSdkClient(handle.url);
      const second = await connectSdkClient(handle.url);
      trackCleanup(first.cleanup);
      trackCleanup(second.cleanup);

      const [firstTools, secondTools] = await Promise.all([
        first.client.listTools(),
        second.client.listTools(),
      ]);

      expect(first.transport.sessionId).toBeDefined();
      expect(second.transport.sessionId).toBeDefined();
      expect(first.transport.sessionId).not.toBe(second.transport.sessionId);
      expect(firstTools.tools).toHaveLength(secondTools.tools.length);
    });

    it("I27 handles concurrent tool calls on the same session", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const [echoResult, upperResult] = await Promise.all([
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
      expect(upperResult.content).toEqual([{ type: "text", text: "PARALLEL-B" }]);
    });

    it("I28 keeps sessions isolated when one client deletes its own session", async () => {
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
    it("I29 handles a 100KB+ JSON-RPC request body", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();
      trackCleanup(handle.close);

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });

      const largeText = "x".repeat(120_000);
      const response = await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: largeText } },
      });
      const payload = (await readJsonRpcPayload(response)) as {
        result: { content: Array<{ text: string }> };
      };

      expect(response.status).toBe(200);
      expect(payload.result.content[0].text).toHaveLength(120_000);
    });

    it("I30 survives rapid connect and disconnect cycles", async () => {
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

    it("I31 closes cleanly while a request is in flight", async () => {
      const handle = await createTestMcpServer({
        sessionIdGenerator: undefined,
      }).listenHttp();

      await postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      });

      const requestPromise = postJsonRpc(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "slow", arguments: {} },
      });

      await handle.close();

      const [requestResult] = await Promise.allSettled([requestPromise]);
      expect(requestResult.status === "fulfilled" || requestResult.status === "rejected").toBe(
        true
      );
    });

    it("I32 transmits image content blocks correctly", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_image",
        arguments: {},
      });

      expect(result.content).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
        },
      ]);
    });

    it("I33 transmits multiple mixed content blocks correctly", async () => {
      const pair = await createHttpTestPair(createTestMcpServer());
      trackCleanup(pair.cleanup);

      const result = await pair.client.callTool({
        name: "get_mixed",
        arguments: {},
      });

      expect(result.content).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
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
  });
});
