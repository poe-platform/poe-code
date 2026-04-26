import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExpressOAuthHandlers,
  createHttpServer,
  type TinyHttpMcpServerOAuthOptions,
} from "./index.js";
import { createTestMcpServer, nodeFetch } from "./testing.js";

const protectedResourceMetadata = {
  resource: "https://example.com/mcp",
  authorizationServers: ["https://auth.example.com"],
  bearerMethodsSupported: ["header"],
  scopesSupported: ["mcp.read", "mcp.write"],
} satisfies TinyHttpMcpServerOAuthOptions;

function createInitializeRequestBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  });
}

describe("OAuth protected resource", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  function trackCleanup(cleanup: () => Promise<void>): void {
    cleanups.add(async () => {
      cleanups.delete(cleanup);
      await cleanup();
    });
  }

  async function listenExpressApp(configure: (app: Express) => void): Promise<{
    baseUrl: string;
    close(): Promise<void>;
  }> {
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

  it("serves protected-resource metadata in standalone mode", async () => {
    const server = createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: protectedResourceMetadata,
    });
    const handle = await server.listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(
      `http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      resource: "https://example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp.read", "mcp.write"],
    });
  });

  it("returns a 401 Bearer challenge that points at the standalone metadata URL", async () => {
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: protectedResourceMetadata,
      enableJsonResponse: true,
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: createInitializeRequestBody(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource"`
    );
  });

  it("allows authenticated standalone MCP requests before token verification exists", async () => {
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: protectedResourceMetadata,
      enableJsonResponse: true,
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer placeholder-token",
        "Content-Type": "application/json",
      },
      body: createInitializeRequestBody(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("serves protected-resource metadata through the Express OAuth handlers", async () => {
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth: protectedResourceMetadata,
    });
    const handle = await listenExpressApp((app) => {
      app.use(handlers.metadataMiddleware);
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(
      `${handle.baseUrl}/.well-known/oauth-protected-resource`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      resource: "https://example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp.read", "mcp.write"],
    });
  });

  it("returns a 401 Bearer challenge that points at the Express metadata URL", async () => {
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth: protectedResourceMetadata,
    });
    const handle = await listenExpressApp((app) => {
      app.use(handlers.metadataMiddleware);
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: createInitializeRequestBody(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource"`
    );
  });

  it("uses forwarded protocol and host when building the Express metadata challenge URL", async () => {
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth: protectedResourceMetadata,
    });
    const handle = await listenExpressApp((app) => {
      app.use(handlers.metadataMiddleware);
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "X-Forwarded-Host": "public.example.com",
        "X-Forwarded-Proto": "https",
      },
      body: createInitializeRequestBody(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp", resource_metadata="https://public.example.com/.well-known/oauth-protected-resource"'
    );
  });
});
