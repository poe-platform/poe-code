import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineSchema } from "tiny-stdio-mcp-server";
import { createExpressMiddleware } from "./express-middleware.js";
import { createHttpServer, type HttpServer } from "./http-server.js";
import { createTestMcpServer } from "./testing.js";

const TEST_PROTOCOL_VERSION = "2025-03-26";
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
    },
  };
}

async function connectSdkClient(url: string): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
  cleanup: () => Promise<void>;
}> {
  const client = new Client({ name: "sdk-express-test-client", version: "1.0.0" });
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

    const signal = init.signal ?? undefined;
    if (signal !== undefined) {
      const onAbort = () => {
        request.destroy(new Error("Request aborted"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => {
        signal.removeEventListener("abort", onAbort);
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
  options: {
    headers?: HeadersInit;
    sessionId?: string;
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
    body: JSON.stringify(message),
  });
}

async function deleteSession(
  url: string,
  options: { headers?: HeadersInit; sessionId?: string } = {}
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (options.sessionId !== undefined) {
    headers.set("Mcp-Session-Id", options.sessionId);
  }

  return nodeFetch(url, {
    method: "DELETE",
    headers,
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
      params: { protocolVersion: TEST_PROTOCOL_VERSION },
    },
    { headers }
  );

  return {
    response,
    sessionId: response.headers.get("mcp-session-id"),
  };
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

describe("createExpressMiddleware", () => {
  it("E1 initializes and lists tools through the SDK client via Express", async () => {
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", createExpressMiddleware(createTestMcpServer()));
    });
    trackCleanup(handle.close);

    const client = await connectSdkClient(`${handle.baseUrl}/mcp`);
    trackCleanup(client.cleanup);

    expect(client.client.getServerVersion()).toEqual({
      name: "conformance-test-server",
      version: "1.0.0",
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
      arguments: { text: "hello from express" },
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "hello from express" }],
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
      params: { protocolVersion: TEST_PROTOCOL_VERSION },
    });

    expect(response.status).toBe(200);
    await expect(readJsonRpcPayload(response)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: TEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "conformance-test-server", version: "1.0.0" },
      },
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
      },
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
      sessionId: sessionId ?? undefined,
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
      params: { protocolVersion: TEST_PROTOCOL_VERSION },
    });
    const authorized = await postJsonRpc(
      `${handle.baseUrl}/mcp`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: TEST_PROTOCOL_VERSION },
      },
      {
        headers: {
          Authorization: "Bearer secret-token",
        },
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
        message: error instanceof Error ? error.message : String(error),
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
      params: { protocolVersion: TEST_PROTOCOL_VERSION },
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
          arguments: { text: "parsed by express" },
        },
      },
      { sessionId: sessionId ?? undefined }
    );

    expect(response.status).toBe(200);
    await expect(readJsonRpcPayload(response)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "parsed by express" }],
      },
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
    const alphaServer = createNamedServer("alpha-server", "alpha_echo", (text) =>
      `alpha:${text}`
    );
    const betaServer = createNamedServer("beta-server", "beta_echo", (text) =>
      `beta:${text}`
    );
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
        arguments: { text: "one" },
      }),
      betaClient.client.callTool({
        name: "beta_echo",
        arguments: { text: "two" },
      }),
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
            sessionIdGenerator: undefined,
          })
        )
      );
    });
    trackCleanup(handle.close);

    const initializeResponse = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: TEST_PROTOCOL_VERSION },
    });
    const callResponse = await postJsonRpc(`${handle.baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "stateless express" } },
    });

    expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();
    expect(callResponse.status).toBe(200);
    await expect(readJsonRpcPayload(callResponse)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "stateless express" }],
      },
    });
  });
});
