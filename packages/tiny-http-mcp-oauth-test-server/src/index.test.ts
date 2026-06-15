import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  HttpTransport,
  McpClient,
  type OAuthSessionStore,
  type StoredOAuthSession,
} from "tiny-mcp-client";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

interface JsonRpcResponse {
  result?: {
    content?: Array<{ type: string; text?: string }>;
  };
}

function createInitializeRequestBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "tiny-http-mcp-oauth-test-server-test",
        version: "1.0.0",
      },
    },
  });
}

function createEchoRequestBody(text: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "echo",
      arguments: {
        text,
      },
    },
  });
}

function createInitializedNotificationBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
}

async function initializeSession(input: {
  url: string;
  token?: string;
}): Promise<{ response: Response; sessionId: string | null }> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });

  if (input.token !== undefined) {
    headers.set("Authorization", `Bearer ${input.token}`);
  }

  const response = await nodeFetch(input.url, {
    method: "POST",
    headers,
    body: createInitializeRequestBody(),
  });

  return {
    response,
    sessionId: response.headers.get("mcp-session-id"),
  };
}

async function reservePort(hostname: string): Promise<number> {
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected temporary port reservation to bind to a TCP port");
  }

  const port = address.port;
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

function createMemorySessionStore(): OAuthSessionStore {
  const sessions = new Map<string, StoredOAuthSession>();

  return {
    async load(resource: string): Promise<StoredOAuthSession | null> {
      return sessions.get(resource) ?? null;
    },
    async save(resource: string, session: StoredOAuthSession): Promise<void> {
      sessions.set(resource, session);
    },
    async clear(resource: string): Promise<void> {
      sessions.delete(resource);
    },
  };
}

describe("createMcpOAuthTestServer", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  it("rejects invalid configured default token TTLs before listening", () => {
    expect(() => createMcpOAuthTestServer({ ttlSeconds: 0 })).toThrow(
      "ttlSeconds must be a positive integer, received 0"
    );
    expect(() => createMcpOAuthTestServer({ ttlSeconds: -1 })).toThrow(
      "ttlSeconds must be a positive integer, received -1"
    );
    expect(() => createMcpOAuthTestServer({ ttlSeconds: Number.POSITIVE_INFINITY })).toThrow(
      "ttlSeconds must be a positive integer, received Infinity"
    );
  });

  it("boots, serves PRM pointing at the embedded authorization server, and rejects unauthenticated MCP traffic", async () => {
    const server = createMcpOAuthTestServer({
      autoApprove: true,
      scopes: ["mcp.read"],
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const prmUrl = new URL("/.well-known/oauth-protected-resource/mcp", handle.mcpUrl);
    const prmResponse = await nodeFetch(prmUrl);

    expect(prmResponse.status).toBe(200);
    await expect(prmResponse.json()).resolves.toMatchObject({
      resource: handle.resource,
      authorization_servers: [handle.oauth.issuer],
    });

    const initialize = await initializeSession({ url: handle.mcpUrl });

    expect(initialize.response.status).toBe(401);
    expect(initialize.response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${prmUrl.toString()}"`
    );
  });

  it("rejects issuer URLs that the embedded HTTP authorization server cannot serve safely", () => {
    expect(() =>
      createMcpOAuthTestServer({
        issuer: "https://127.0.0.1:43191/oauth",
      })
    ).toThrow("issuer must use http:");

    expect(() =>
      createMcpOAuthTestServer({
        issuer: "http://127.0.0.1:43191",
      })
    ).toThrow("issuer must include a non-root path");

    expect(() =>
      createMcpOAuthTestServer({
        issuer: "http://127.0.0.1:43191/oauth?tenant=demo",
      })
    ).toThrow("issuer must not include a query or fragment");

    expect(() =>
      createMcpOAuthTestServer({
        issuer: "http://127.0.0.1:43191/oauth#fragment",
      })
    ).toThrow("issuer must not include a query or fragment");
  });

  it("rejects unsupported protected-resource and route configuration", () => {
    expect(() => createMcpOAuthTestServer({ resource: "/mcp" })).toThrow(
      "resource must be an absolute URL"
    );
    expect(() => createMcpOAuthTestServer({ resource: "https://resource.example/mcp#fragment" })).toThrow(
      "resource must not include a fragment"
    );
    expect(() => createMcpOAuthTestServer({ mcpPath: "/mcp?tenant=demo" })).toThrow(
      "mcpPath must not include a query or fragment"
    );
    expect(() => createMcpOAuthTestServer({ mcpPath: "/mcp#fragment" })).toThrow(
      "mcpPath must not include a query or fragment"
    );
    expect(() => createMcpOAuthTestServer({ scopes: ["mcp.read", "   "] })).toThrow(
      "scopes must contain non-empty values"
    );
    expect(() => createMcpOAuthTestServer({ scopes: ["mcp.read mcp.write"] })).toThrow(
      "scope entries must not contain spaces"
    );
  });

  it("rejects invalid listen ports at the SDK boundary", async () => {
    for (const port of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 70000]) {
      const server = createMcpOAuthTestServer();

      await expect(
        server.listen({ port, hostname: "127.0.0.1" })
      ).rejects.toThrow("port must be an integer between 0 and 65535");
    }
  });

  it("accepts direct tokens from the embedded OAuth server and exposes the test MCP tools", async () => {
    const server = createMcpOAuthTestServer({
      autoApprove: true,
      scopes: ["mcp.read"],
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const token = await handle.oauth.issueTokenFor({
      clientId: "demo-client",
      resource: handle.resource,
      scopes: ["mcp.read"],
    });
    const initialize = await initializeSession({
      url: handle.mcpUrl,
      token,
    });

    expect(initialize.response.status).toBe(200);
    expect(initialize.sessionId).toBeTruthy();

    const sessionHeaders = {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Mcp-Session-Id": initialize.sessionId ?? "",
      "MCP-Protocol-Version": "2025-03-26",
    };
    const initialized = await nodeFetch(handle.mcpUrl, {
      method: "POST",
      headers: sessionHeaders,
      body: createInitializedNotificationBody(),
    });

    expect(initialized.status).toBe(202);

    const response = await nodeFetch(handle.mcpUrl, {
      method: "POST",
      headers: sessionHeaders,
      body: createEchoRequestBody("hello"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject<JsonRpcResponse>({
      result: {
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("rejects concurrent listener startup on one server instance", async () => {
    const server = createMcpOAuthTestServer({ autoApprove: true, scopes: ["mcp.read"] });
    const results = await Promise.allSettled([
      server.listen({ port: 0, hostname: "127.0.0.1" }),
      server.listen({ port: 0, hostname: "127.0.0.1" })
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof server.listen>>> =>
        result.status === "fulfilled"
    );

    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    if (fulfilled[0]) {
      await fulfilled[0].value.close();
    }
  });

  it("does not let a stale handle orphan a replacement listener", async () => {
    const server = createMcpOAuthTestServer({ autoApprove: true, scopes: ["mcp.read"] });
    const first = await server.listen({ port: 0, hostname: "127.0.0.1" });
    await first.close();
    const second = await server.listen({ port: 0, hostname: "127.0.0.1" });

    await first.close();
    await second.close();

    await expect(nodeFetch(second.mcpUrl)).rejects.toThrow();
  });

  it("rejects a direct token whose audience is bound to a different resource", async () => {
    const server = createMcpOAuthTestServer({
      autoApprove: true,
      scopes: ["mcp.read"],
      resource: "https://resource.example.com/mcp",
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const token = await handle.oauth.issueTokenFor({
      clientId: "wrong-audience-client",
      resource: "https://resource.example.com/other",
      scopes: ["mcp.read"],
    });

    const initialize = await initializeSession({
      url: handle.mcpUrl,
      token,
    });

    expect(initialize.response.status).toBe(401);
    expect(initialize.response.headers.get("www-authenticate")).toContain(
      'error_description="audience mismatch"'
    );
  });

  it("honors an explicit issuer URL for both discovery and direct-token verification", async () => {
    const issuerPort = await reservePort("127.0.0.1");
    const issuer = `http://127.0.0.1:${issuerPort}/oauth`;
    const server = createMcpOAuthTestServer({
      issuer,
      autoApprove: true,
      scopes: ["mcp.read"],
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    expect(handle.oauth.issuer).toBe(issuer);

    const prmResponse = await nodeFetch(handle.prmUrl);
    await expect(prmResponse.json()).resolves.toMatchObject({
      authorization_servers: [issuer],
    });

    const token = await handle.oauth.issueTokenFor({
      clientId: "issuer-bound-client",
      resource: handle.resource,
      scopes: ["mcp.read"],
    });
    const initialize = await initializeSession({
      url: handle.mcpUrl,
      token,
    });

    expect(initialize.response.status).toBe(200);
  });

  it("supports the full discovery, DCR, and PKCE flow via tiny-mcp-client", async () => {
    const server = createMcpOAuthTestServer({
      autoApprove: true,
      scopes: ["mcp.read"],
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const authorizationRequests: string[] = [];
    const client = new McpClient({
      clientInfo: {
        name: "tiny-http-mcp-oauth-test-server-test",
        version: "1.0.0",
      },
    });
    cleanups.add(async () => {
      await client.close();
    });

    const transport = new HttpTransport({
      url: handle.mcpUrl,
      fetch: nodeFetch,
      oauth: {
        client: {
          mode: "dynamic",
          metadata: {
            clientName: "tiny-http-mcp-oauth-test-server test client",
          },
        },
        sessionStore: createMemorySessionStore(),
        browser: {
          async openBrowser(authorizationUrl) {
            authorizationRequests.push(authorizationUrl);
            const authorizationResponse = await nodeFetch(authorizationUrl);
            expect(authorizationResponse.status).toBe(302);

            const callbackUrl = authorizationResponse.headers.get("location");
            expect(callbackUrl).toBeTruthy();

            const callbackResponse = await nodeFetch(callbackUrl ?? "");
            expect(callbackResponse.ok).toBe(true);
            await callbackResponse.text();
          },
        },
      },
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("echo");

    const result = await client.callTool({
      name: "echo",
      arguments: {
        text: "oauth client",
      },
    });

    expect(authorizationRequests).toHaveLength(1);
    expect(new URL(authorizationRequests[0] ?? "").searchParams.get("resource")).toBe(
      handle.resource
    );
    expect(result).toMatchObject({
      content: [{ type: "text", text: "oauth client" }],
    });
  });
});
