import http, { type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExpressMiddleware,
  createExpressOAuthHandlers,
  createHttpServer,
  defineSchema,
  type TinyHttpMcpServerOAuthOptions
} from "./index.js";
import { createInMemoryTokenVerifier, createTestMcpServer, nodeFetch } from "./testing.js";

const TEST_NOW = Date.UTC(2026, 3, 26, 12, 0, 0) / 1_000;
const PROTECTED_RESOURCE = "https://example.com/mcp";
const AUTHORIZATION_SERVER = "https://auth.example.com";
const REQUIRED_SCOPE = "mcp.read";

function readChallengeParam(challenge: string | null, name: string): string | null {
  if (challenge === null) {
    return null;
  }

  const prefix = `${name}="`;
  const startIndex = challenge.indexOf(prefix);
  if (startIndex < 0) {
    return null;
  }

  const valueStart = startIndex + prefix.length;
  const valueEnd = challenge.indexOf('"', valueStart);
  if (valueEnd < 0) {
    return null;
  }

  return challenge.slice(valueStart, valueEnd);
}

function createInitializeRequestBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" }
  });
}

function createToolCallRequestBody(name: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name,
      arguments: {}
    }
  });
}

function createProtectedResourceMetadata(): {
  oauth: TinyHttpMcpServerOAuthOptions;
  verifier: ReturnType<typeof createInMemoryTokenVerifier>;
} {
  const verifier = createInMemoryTokenVerifier({
    now: () => TEST_NOW
  });

  return {
    oauth: {
      resource: PROTECTED_RESOURCE,
      authorizationServers: [AUTHORIZATION_SERVER],
      bearerMethodsSupported: ["header"],
      scopesSupported: [REQUIRED_SCOPE, "mcp.write"],
      requiredScopes: [REQUIRED_SCOPE],
      verifier: verifier.verifier
    },
    verifier
  };
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
      }
    };
  }

  it("serves protected-resource metadata in standalone mode", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth
    });
    const handle = await server.listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(
      `http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=");
    await expect(response.json()).resolves.toEqual({
      resource: PROTECTED_RESOURCE,
      authorization_servers: [AUTHORIZATION_SERVER],
      bearer_methods_supported: ["header"],
      scopes_supported: [REQUIRED_SCOPE, "mcp.write"]
    });
  });

  it("serves standalone protected-resource metadata only from the RFC 9728 path-based location for non-root paths", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: {
        ...oauth,
        resource: "https://example.com/tenant/mcp"
      }
    }).listenHttp({ port: 0, path: "/tenant/mcp" });
    trackCleanup(handle.close);

    const pathResponse = await nodeFetch(
      `http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/tenant/mcp`
    );
    const rootResponse = await nodeFetch(
      `http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource`
    );

    expect(pathResponse.status).toBe(200);
    expect(rootResponse.status).toBe(404);
  });

  it("returns a 401 Bearer challenge that points at the standalone metadata URL", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("keeps the standalone challenge resource_metadata URL fetchable when the configured path ends with a trailing slash", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0, path: "/mcp/" });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const resourceMetadataUrl = readChallengeParam(
      response.headers.get("www-authenticate"),
      "resource_metadata"
    );

    expect(response.status).toBe(401);
    expect(resourceMetadataUrl).toBeTruthy();
    await expect(nodeFetch(resourceMetadataUrl ?? "")).resolves.toMatchObject({
      status: 200
    });
  });

  it("allows standalone MCP requests with a verified bearer token", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "valid-token",
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300,
      clientId: "test-client",
      subject: "alice"
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("allows standalone CORS preflight without a bearer token", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      allowedOrigins: ["https://client.example.com"],
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const preflight = await nodeFetch(handle.url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"
      }
    });
    const post = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "authorization,content-type"
    );
    expect(post.status).toBe(401);
  });

  it("serves protected-resource metadata through the Express OAuth handlers", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth
    });
    const handle = await listenExpressApp((app) => {
      app.use(handlers.metadataMiddleware);
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/.well-known/oauth-protected-resource/mcp`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=");
    await expect(response.json()).resolves.toEqual({
      resource: PROTECTED_RESOURCE,
      authorization_servers: [AUTHORIZATION_SERVER],
      bearer_methods_supported: ["header"],
      scopes_supported: [REQUIRED_SCOPE, "mcp.write"]
    });
  });

  it("allows Express CORS preflight without a bearer token", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createHttpServer({
      name: "oauth-express-server",
      version: "1.0.0",
      allowedOrigins: ["https://client.example.com"],
      enableJsonResponse: true
    });
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server,
      oauth
    });
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const preflight = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example.com",
        "Access-Control-Request-Method": "POST"
      }
    });
    const post = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
    expect(post.status).toBe(401);
  });

  it("serves Express protected-resource metadata only from the RFC 9728 path-based location for non-root paths", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handlers = createExpressOAuthHandlers({
      path: "/tenant/mcp",
      server: createTestMcpServer(),
      oauth: {
        ...oauth,
        resource: "https://example.com/tenant/mcp"
      }
    });
    const handle = await listenExpressApp((app) => {
      app.use(handlers.metadataMiddleware);
      app.use("/tenant/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const pathResponse = await nodeFetch(
      `${handle.baseUrl}/.well-known/oauth-protected-resource/tenant/mcp`
    );
    const rootResponse = await nodeFetch(`${handle.baseUrl}/.well-known/oauth-protected-resource`);

    expect(pathResponse.status).toBe(200);
    expect(rootResponse.status).toBe(404);
  });

  it("returns a 401 Bearer challenge that points at the Express metadata URL", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth
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
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("uses the Express mount path in OAuth challenges from createExpressMiddleware", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createTestMcpServer({ oauth });
    const handle = await listenExpressApp((app) => {
      app.use("/api/v1/mcp", createExpressMiddleware(server));
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/api/v1/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource/api/v1/mcp"`
    );
  });

  it("uses the full Express mount path through nested routers", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createTestMcpServer({ oauth });
    const handle = await listenExpressApp((app) => {
      const router = express.Router();
      router.use("/v1/mcp", createExpressMiddleware(server));
      app.use("/api", router);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/api/v1/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource/api/v1/mcp"`
    );
  });

  it("falls back to /mcp when Express baseUrl is empty", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createTestMcpServer({ oauth });
    const handle = await listenExpressApp((app) => {
      app.use(createExpressMiddleware(server));
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("returns 503 without a Bearer challenge through the Express OAuth handlers", async () => {
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth: {
        resource: PROTECTED_RESOURCE,
        authorizationServers: [AUTHORIZATION_SERVER],
        bearerMethodsSupported: ["header"],
        scopesSupported: [REQUIRED_SCOPE],
        requiredScopes: [REQUIRED_SCOPE],
        verifier: {
          async verify() {
            throw Object.assign(new Error("identity provider unavailable"), {
              error: "temporarily_unavailable" as const
            });
          }
        }
      }
    });
    const handle = await listenExpressApp((app) => {
      app.use("/mcp", handlers.mcpMiddleware);
    });
    trackCleanup(handle.close);

    const response = await nodeFetch(`${handle.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer verifier-error-token",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("returns 403 insufficient_scope through the Express OAuth handlers", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "wrong-scope-token-express",
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: ["mcp.write"],
      expiresAt: TEST_NOW + 300
    });
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth
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
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });

  it("ignores forwarded protocol and host when building the Express metadata challenge URL", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handlers = createExpressOAuthHandlers({
      path: "/mcp",
      server: createTestMcpServer(),
      oauth
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
        "X-Forwarded-Proto": "https"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="${handle.baseUrl}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("ignores malformed forwarded protocols when building the challenge URL", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "not a protocol"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("returns a challenge instead of throwing when the Host header is malformed", async () => {
    const { oauth } = createProtectedResourceMetadata();
    const server = createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    });
    const req = Object.assign(Readable.from([createInitializeRequestBody()]), {
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        host: "bad host"
      },
      socket: {}
    }) as IncomingMessage;
    const headers = new Map<string, string | number | readonly string[]>();
    const res = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      writeHead(
        this: { statusCode: number; headersSent: boolean },
        statusCode: number,
        responseHeaders: Record<string, string>
      ) {
        this.statusCode = statusCode;
        this.headersSent = true;
        for (const [name, value] of Object.entries(responseHeaders)) {
          headers.set(name.toLowerCase(), value);
        }
        return this;
      },
      end(this: { writableEnded: boolean }) {
        this.writableEnded = true;
        return this;
      }
    };

    await server.handleRequest(req, res as never);

    expect(res.statusCode).toBe(401);
    expect(headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("rejects bearer tokens with embedded tab characters before verifier calls", async () => {
    const verifier = {
      verify: vi.fn(async () => {
        throw new Error("not reached");
      })
    };
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: {
        resource: PROTECTED_RESOURCE,
        authorizationServers: [AUTHORIZATION_SERVER],
        requiredScopes: [REQUIRED_SCOPE],
        verifier
      },
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer abc\tdef",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="malformed bearer token"`
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("returns invalid_token when the bearer token is expired", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "expired-token",
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW - 1
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="token expired"`
    );
  });

  it("returns invalid_token when the bearer token audience does not match the configured resource", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "wrong-audience-token",
      issuer: AUTHORIZATION_SERVER,
      audience: ["https://example.com/other"],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="audience mismatch"`
    );
  });

  it("does not trust forwarded hosts when comparing audience against the configured resource", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "forwarded-host-audience-token",
      issuer: AUTHORIZATION_SERVER,
      audience: ["https://public.example.com/mcp"],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Forwarded-Host": "public.example.com",
        "X-Forwarded-Proto": "https"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="audience mismatch"`
    );
  });

  it("returns invalid_token when the bearer token issuer does not match the configured authorization server", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "wrong-issuer-token",
      issuer: "https://rogue.example.com",
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="issuer mismatch"`
    );
  });

  it("returns 403 insufficient_scope when the bearer token lacks any required scope", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "wrong-scope-token",
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: ["mcp.write"],
      expiresAt: TEST_NOW + 300
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="insufficient scope", scope="${REQUIRED_SCOPE}"`
    );
  });

  it("centrally rejects verified tokens missing required scopes", async () => {
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: {
        resource: PROTECTED_RESOURCE,
        authorizationServers: [AUTHORIZATION_SERVER],
        bearerMethodsSupported: ["header"],
        scopesSupported: [REQUIRED_SCOPE, "mcp.write"],
        requiredScopes: [REQUIRED_SCOPE],
        verifier: {
          async verify({ token }) {
            return {
              token,
              issuer: AUTHORIZATION_SERVER,
              audience: [PROTECTED_RESOURCE],
              scopes: ["mcp.write"],
              expiresAt: TEST_NOW + 300,
              claims: {}
            };
          }
        }
      },
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer verifier-ignored-scopes",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("www-authenticate")).toContain(`scope="${REQUIRED_SCOPE}"`);
  });

  it("closes an OAuth SSE stream when its bearer token expires", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 60,
      subject: "alice"
    });
    const events: Array<{ type: string }> = [];
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true,
      sseKeepAliveMs: 0,
      observability: {
        onEvent(event) {
          events.push(event);
        }
      }
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(TEST_NOW * 1_000);
    try {
      const streamResponse = await nodeFetch(handle.url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
          "Mcp-Session-Id": String(sessionId),
          "MCP-Protocol-Version": "2025-03-26"
        }
      });
      const reader = streamResponse.body!.getReader();
      const closed = reader.read();

      expect(streamResponse.status).toBe(200);
      expect(events.some((event) => event.type === "stream.closed")).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(closed).resolves.toMatchObject({ done: true });
      expect(events.some((event) => event.type === "stream.closed")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts verifier errors from external packages when they expose the Bearer challenge fields", async () => {
    const oauth = {
      resource: PROTECTED_RESOURCE,
      authorizationServers: [AUTHORIZATION_SERVER],
      bearerMethodsSupported: ["header"] as const,
      scopesSupported: [REQUIRED_SCOPE],
      requiredScopes: [REQUIRED_SCOPE],
      verifier: {
        async verify() {
          throw Object.assign(new Error("insufficient scope"), {
            error: "insufficient_scope" as const,
            errorDescription: "insufficient scope",
            scope: [REQUIRED_SCOPE]
          });
        }
      }
    };
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer verifier-error-token",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="insufficient scope", scope="${REQUIRED_SCOPE}"`
    );
  });

  it("does not disclose unexpected verifier exception messages", async () => {
    const oauth = {
      resource: PROTECTED_RESOURCE,
      authorizationServers: [AUTHORIZATION_SERVER],
      bearerMethodsSupported: ["header"] as const,
      scopesSupported: [REQUIRED_SCOPE],
      requiredScopes: [REQUIRED_SCOPE],
      verifier: {
        async verify() {
          throw new Error("database-password=s3cr3t");
        }
      }
    };
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer verifier-error-token",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer realm="mcp", resource_metadata="http://127.0.0.1:${handle.port}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="token verification failed"`
    );
  });

  it("returns 503 without a Bearer challenge when token verification is temporarily unavailable", async () => {
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth: {
        resource: PROTECTED_RESOURCE,
        authorizationServers: [AUTHORIZATION_SERVER],
        bearerMethodsSupported: ["header"] as const,
        scopesSupported: [REQUIRED_SCOPE],
        requiredScopes: [REQUIRED_SCOPE],
        verifier: {
          async verify() {
            throw Object.assign(new Error("token verification temporarily unavailable"), {
              error: "temporarily_unavailable" as const,
              errorDescription: "token verification temporarily unavailable"
            });
          }
        }
      },
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer verifier-error-token",
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("passes the session id and verified auth to tools through context", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const token = verifier.issueToken({
      token: "claims-token",
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE, "mcp.write"],
      expiresAt: TEST_NOW + 300,
      clientId: "test-client",
      subject: "alice",
      claims: {
        tenant: "acme"
      }
    });
    const server = createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).tool("auth_snapshot", "Return auth info", defineSchema({}), (_args, context) =>
      JSON.stringify({
        sessionId: context.sessionId,
        token: context.auth?.token,
        clientId: context.auth?.clientId,
        scopes: context.auth?.scopes,
        issuer: context.auth?.issuer,
        audience: context.auth?.audience,
        subject: context.auth?.subject,
        resource: context.auth?.resource?.toString(),
        claims: context.auth?.claims
      })
    );
    const handle = await server.listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    expect(initializeResponse.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const initializedResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(sessionId === null
          ? {}
          : {
              "Mcp-Session-Id": sessionId,
              "MCP-Protocol-Version": "2025-03-26"
            })
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    expect(initializedResponse.status).toBe(202);

    const toolResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(sessionId === null
          ? {}
          : {
              "Mcp-Session-Id": sessionId,
              "MCP-Protocol-Version": "2025-03-26"
            })
      },
      body: createToolCallRequestBody("auth_snapshot")
    });

    expect(toolResponse.status).toBe(200);

    const payload = (await toolResponse.json()) as {
      result?: {
        content?: Array<{ type: string; text?: string }>;
      };
    };
    const text = payload.result?.content?.[0]?.text;

    expect(text).toBeTruthy();
    expect(JSON.parse(String(text))).toEqual({
      sessionId,
      token,
      clientId: "test-client",
      scopes: [REQUIRED_SCOPE, "mcp.write"],
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      subject: "alice",
      resource: PROTECTED_RESOURCE,
      claims: {
        iss: AUTHORIZATION_SERVER,
        aud: PROTECTED_RESOURCE,
        exp: TEST_NOW + 300,
        scope: `${REQUIRED_SCOPE} mcp.write`,
        sub: "alice",
        client_id: "test-client",
        tenant: "acme"
      }
    });
  });
  it("binds OAuth sessions to the verified token subject", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const issueToken = (subject: string) =>
      verifier.issueToken({
        issuer: AUTHORIZATION_SERVER,
        audience: [PROTECTED_RESOURCE],
        scopes: [REQUIRED_SCOPE],
        expiresAt: TEST_NOW + 300,
        subject
      });
    const ownerToken = issueToken("a");
    const otherToken = issueToken("b");
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    expect(initializeResponse.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const sessionHeaders = {
      Authorization: `Bearer ${otherToken}`,
      "Mcp-Session-Id": String(sessionId),
      "MCP-Protocol-Version": "2025-03-26"
    };
    const otherPostResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        ...sessionHeaders,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    const otherGetResponse = await nodeFetch(handle.url, {
      method: "GET",
      headers: {
        ...sessionHeaders,
        Accept: "text/event-stream"
      }
    });
    const otherDeleteResponse = await nodeFetch(handle.url, {
      method: "DELETE",
      headers: sessionHeaders
    });

    expect(otherPostResponse.status).toBe(404);
    expect(otherGetResponse.status).toBe(404);
    expect(otherDeleteResponse.status).toBe(404);

    const ownerResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    expect(ownerResponse.status).toBe(202);
  });

  it("uses the verified client id when the token has no subject", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const issueToken = (clientId: string) =>
      verifier.issueToken({
        issuer: AUTHORIZATION_SERVER,
        audience: [PROTECTED_RESOURCE],
        scopes: [REQUIRED_SCOPE],
        expiresAt: TEST_NOW + 300,
        clientId
      });
    const ownerToken = issueToken("client-a");
    const replacementOwnerToken = issueToken("client-a");
    const otherToken = issueToken("client-b");
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    expect(initializeResponse.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const otherResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    const ownerResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${replacementOwnerToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    expect(otherResponse.status).toBe(404);
    expect(ownerResponse.status).toBe(202);
  });

  it("prefers subject over client id when binding OAuth sessions", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const issueToken = (subject: string, clientId: string) =>
      verifier.issueToken({
        issuer: AUTHORIZATION_SERVER,
        audience: [PROTECTED_RESOURCE],
        scopes: [REQUIRED_SCOPE],
        expiresAt: TEST_NOW + 300,
        subject,
        clientId
      });
    const ownerToken = issueToken("subject-a", "client-a");
    const sameSubjectToken = issueToken("subject-a", "client-b");
    const sameClientToken = issueToken("subject-b", "client-a");
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    expect(initializeResponse.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const sameClientResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${sameClientToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    const sameSubjectResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${sameSubjectToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    expect(sameClientResponse.status).toBe(404);
    expect(sameSubjectResponse.status).toBe(202);
  });

  it("leaves OAuth sessions unbound when the verified token has no identity", async () => {
    const { oauth, verifier } = createProtectedResourceMetadata();
    const unboundToken = verifier.issueToken({
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300
    });
    const identifiedToken = verifier.issueToken({
      issuer: AUTHORIZATION_SERVER,
      audience: [PROTECTED_RESOURCE],
      scopes: [REQUIRED_SCOPE],
      expiresAt: TEST_NOW + 300,
      subject: "other-subject"
    });
    const handle = await createHttpServer({
      name: "oauth-http-server",
      version: "1.0.0",
      oauth,
      enableJsonResponse: true
    }).listenHttp({ port: 0 });
    trackCleanup(handle.close);

    const initializeResponse = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${unboundToken}`,
        "Content-Type": "application/json"
      },
      body: createInitializeRequestBody()
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    expect(initializeResponse.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const response = await nodeFetch(handle.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${identifiedToken}`,
        "Content-Type": "application/json",
        "Mcp-Session-Id": String(sessionId),
        "MCP-Protocol-Version": "2025-03-26"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    expect(response.status).toBe(202);
  });
});
