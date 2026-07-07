import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OAuthError, type OAuthSessionStore, type StoredOAuthSession } from "mcp-oauth";
import { installInMemoryHttp, nodeFetch } from "tiny-http-mcp-server/test-support";
import {
  createMcpOAuthTestServer,
  type McpOAuthTestServerHandle,
  type McpOAuthTestServerOptions
} from "tiny-http-mcp-oauth-test-server";
import { HttpTransport, McpClient, resolveAuthorizationServerMetadataUrl } from "./internal.js";

installInMemoryHttp();

interface RequestRecord {
  url: string;
  method: string;
  authorization: string | null;
  sessionId: string | null;
  body: string | undefined;
}

interface SessionStoreWithMap {
  sessions: Map<string, StoredOAuthSession>;
  store: OAuthSessionStore;
}

interface OAuthClientHarness {
  client: McpClient;
  close(): Promise<void>;
  handle: McpOAuthTestServerHandle;
  requests: RequestRecord[];
  sessionStore: SessionStoreWithMap;
  setNow(value: number): void;
  transport: HttpTransport;
}

interface TrafficSummary {
  authorize: number;
  asMetadata: number;
  mcpPost: number;
  prm: number;
  register: number;
  tokenAuthorizationCode: number;
  tokenRefresh: number;
}

interface AuthorizationServerTrafficSummary {
  authorize: number;
  metadata: number;
  register: number;
  tokenAuthorizationCode: number;
  tokenRefresh: number;
}

function createSessionStore(): SessionStoreWithMap {
  const sessions = new Map<string, StoredOAuthSession>();

  return {
    sessions,
    store: {
      async load(resource: string): Promise<StoredOAuthSession | null> {
        return sessions.get(resource) ?? null;
      },
      async save(resource: string, session: StoredOAuthSession): Promise<void> {
        sessions.set(resource, session);
      },
      async clear(resource: string): Promise<void> {
        sessions.delete(resource);
      }
    }
  };
}

function cloneResponse(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

interface BoundLoopbackServerFactory {
  createServer(): http.Server;
  port: number;
}

async function createBoundLoopbackServerFactory(
  hostname: string
): Promise<BoundLoopbackServerFactory> {
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    throw new Error("Expected loopback test server to bind to a TCP port");
  }

  server.listen = ((...args: Parameters<http.Server["listen"]>) => {
    const callback = [...args].reverse().find((value) => typeof value === "function");
    if (typeof callback === "function") {
      queueMicrotask(() => callback());
    }

    return server;
  }) as typeof server.listen;

  return {
    createServer(): http.Server {
      return server;
    },
    port: address.port
  };
}

function parseJsonBody(record: RequestRecord): Record<string, unknown> {
  if (record.body === undefined) {
    throw new Error(`Expected JSON body for ${record.method} ${record.url}`);
  }

  return JSON.parse(record.body) as Record<string, unknown>;
}

function parseFormBody(record: RequestRecord): URLSearchParams {
  return new URLSearchParams(record.body ?? "");
}

function requireRequest(request: RequestRecord | undefined, description: string): RequestRecord {
  if (request === undefined) {
    throw new Error(`Expected ${description}`);
  }

  return request;
}

function findLastRequest(
  requests: readonly RequestRecord[],
  predicate: (request: RequestRecord) => boolean,
  description: string
): RequestRecord {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (request !== undefined && predicate(request)) {
      return request;
    }
  }

  throw new Error(`Expected ${description}`);
}

function summarizeTraffic(
  requests: readonly RequestRecord[],
  handle: McpOAuthTestServerHandle
): TrafficSummary {
  const authorizationServerMetadataUrl = resolveAuthorizationServerMetadataUrl(handle.oauth.issuer);
  const authorizeUrl = `${handle.oauth.issuer}/authorize`;
  const registerUrl = `${handle.oauth.issuer}/register`;
  const tokenUrl = `${handle.oauth.issuer}/token`;

  return {
    prm: requests.filter((request) => request.method === "GET" && request.url === handle.prmUrl)
      .length,
    asMetadata: requests.filter(
      (request) =>
        request.method === "GET" && request.url === authorizationServerMetadataUrl.toString()
    ).length,
    register: requests.filter((request) => request.method === "POST" && request.url === registerUrl)
      .length,
    authorize: requests.filter(
      (request) => request.method === "GET" && request.url.startsWith(authorizeUrl)
    ).length,
    tokenAuthorizationCode: requests.filter((request) => {
      if (request.method !== "POST" || request.url !== tokenUrl) {
        return false;
      }

      return parseFormBody(request).get("grant_type") === "authorization_code";
    }).length,
    tokenRefresh: requests.filter((request) => {
      if (request.method !== "POST" || request.url !== tokenUrl) {
        return false;
      }

      return parseFormBody(request).get("grant_type") === "refresh_token";
    }).length,
    mcpPost: requests.filter(
      (request) => request.method === "POST" && request.url === handle.mcpUrl
    ).length
  };
}

function summarizeAuthorizationServerTraffic(
  handle: McpOAuthTestServerHandle
): AuthorizationServerTrafficSummary {
  const requestLog = handle.oauth.requestLog;
  const authorizationServerMetadataUrl = resolveAuthorizationServerMetadataUrl(handle.oauth.issuer);
  const authorizeUrl = `${handle.oauth.issuer}/authorize`;
  const registerUrl = `${handle.oauth.issuer}/register`;
  const tokenUrl = `${handle.oauth.issuer}/token`;

  return {
    metadata: requestLog.filter(
      (request) =>
        request.method === "GET" && request.url === authorizationServerMetadataUrl.toString()
    ).length,
    register: requestLog.filter(
      (request) => request.method === "POST" && request.url === registerUrl
    ).length,
    authorize: requestLog.filter(
      (request) => request.method === "GET" && request.url.startsWith(authorizeUrl)
    ).length,
    tokenAuthorizationCode: requestLog.filter((request) => {
      if (request.method !== "POST" || request.url !== tokenUrl) {
        return false;
      }

      return new URLSearchParams(request.body ?? "").get("grant_type") === "authorization_code";
    }).length,
    tokenRefresh: requestLog.filter((request) => {
      if (request.method !== "POST" || request.url !== tokenUrl) {
        return false;
      }

      return new URLSearchParams(request.body ?? "").get("grant_type") === "refresh_token";
    }).length
  };
}

function getJsonRpcMethod(record: RequestRecord): string | undefined {
  if (record.body === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(record.body) as { method?: unknown };
    return typeof parsed.method === "string" ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

function getTextContent(result: unknown): string | undefined {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return undefined;
  }

  const [firstItem] = result.content;
  if (
    typeof firstItem !== "object" ||
    firstItem === null ||
    !("text" in firstItem) ||
    typeof firstItem.text !== "string"
  ) {
    return undefined;
  }

  return firstItem.text;
}

function getStoredSession(harness: OAuthClientHarness): StoredOAuthSession {
  const session = harness.sessionStore.sessions.get(harness.handle.mcpUrl);
  if (session === undefined) {
    throw new Error("Expected OAuth session to be stored");
  }

  return session;
}

async function createHarness(
  options: {
    now?: () => number;
    oauthClient?:
      | {
          mode: "dynamic";
          metadata?: {
            clientName?: string;
            scope?: string;
          };
        }
      | {
          mode: "static";
          clientId: string;
          clientSecret?: string;
          metadata?: {
            clientName?: string;
            scope?: string;
          };
        };
    responseTransform?: (input: {
      handle: McpOAuthTestServerHandle;
      record: RequestRecord;
      response: Response;
    }) => Promise<Response | undefined>;
    serverOptions?: McpOAuthTestServerOptions;
    createServer?: () => http.Server;
  } = {}
): Promise<OAuthClientHarness> {
  const server = createMcpOAuthTestServer({
    autoApprove: true,
    scopes: ["mcp.read"],
    ...(options.serverOptions ?? {})
  });
  const handle = await server.listen({
    port: 0,
    hostname: "127.0.0.1"
  });
  const requests: RequestRecord[] = [];
  const sessionStore = createSessionStore();
  let currentNow = options.now?.() ?? 10_000;
  const fetchImpl = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const record: RequestRecord = {
      url: input.toString(),
      method: init.method ?? "GET",
      authorization: new Headers(init.headers).get("authorization"),
      sessionId: new Headers(init.headers).get("mcp-session-id"),
      body: typeof init.body === "string" ? init.body : undefined
    };
    const response = await nodeFetch(record.url, init);
    const transformed =
      options.responseTransform === undefined
        ? undefined
        : await options.responseTransform({
            handle,
            record,
            response
          });

    requests.push(record);
    return transformed ?? response;
  };
  const client = new McpClient({
    clientInfo: {
      name: "tiny-mcp-client-http-oauth-integration-test",
      version: "1.0.0"
    }
  });
  const transport = new HttpTransport({
    url: handle.mcpUrl,
    fetch: fetchImpl,
    oauth: {
      client: options.oauthClient ?? {
        mode: "dynamic",
        metadata: {
          clientName: "tiny-mcp-client integration test"
        }
      },
      browser: {
        async openBrowser(authorizationUrl) {
          const authorizationResponse = await fetchImpl(authorizationUrl, {
            method: "GET"
          });
          if (authorizationResponse.status !== 302) {
            throw new Error(
              `Expected authorization redirect, received ${authorizationResponse.status}: ${await authorizationResponse.text()}`
            );
          }

          const callbackUrl = authorizationResponse.headers.get("location");
          expect(callbackUrl).toBeTruthy();

          const callbackResponse = await fetchImpl(callbackUrl ?? "", {
            method: "GET"
          });
          expect(callbackResponse.ok).toBe(true);
          await callbackResponse.text();
        },
        ...(options.createServer === undefined
          ? {}
          : {
              createServer: options.createServer
            })
      },
      now: () => currentNow,
      sessionStore: sessionStore.store
    }
  });

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await handle.close();
    },
    handle,
    requests,
    sessionStore,
    setNow(value: number): void {
      currentNow = value;
    },
    transport
  };
}

describe("HttpTransport OAuth integration", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  it("runs discovery, DCR, PKCE authorization, attaches the bearer, and reuses the cached token", async () => {
    const harness = await createHarness();
    cleanups.add(harness.close);

    await harness.client.connect(harness.transport);

    const firstResult = await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "first-call"
      }
    });

    expect(getTextContent(firstResult)).toBe("first-call");

    const summaryAfterFirstCall = summarizeTraffic(harness.requests, harness.handle);
    expect(summaryAfterFirstCall).toEqual({
      authorize: 1,
      asMetadata: 1,
      mcpPost: 4,
      prm: 1,
      register: 1,
      tokenAuthorizationCode: 1,
      tokenRefresh: 0
    });
    expect(summarizeAuthorizationServerTraffic(harness.handle)).toEqual({
      authorize: 1,
      metadata: 1,
      register: 1,
      tokenAuthorizationCode: 1,
      tokenRefresh: 0
    });

    const initializePosts = harness.requests.filter(
      (request) =>
        request.method === "POST" &&
        request.url === harness.handle.mcpUrl &&
        getJsonRpcMethod(request) === "initialize"
    );
    expect(initializePosts).toHaveLength(2);
    expect(initializePosts[0]?.authorization).toBeNull();
    expect(initializePosts[1]?.authorization).toMatch(/^Bearer /);

    const callToolPosts = harness.requests.filter(
      (request) =>
        request.method === "POST" &&
        request.url === harness.handle.mcpUrl &&
        getJsonRpcMethod(request) === "tools/call"
    );
    expect(callToolPosts).toHaveLength(1);
    expect(callToolPosts[0]?.authorization).toMatch(/^Bearer /);

    const registrationRequest = harness.requests.find(
      (request) =>
        request.method === "POST" && request.url === `${harness.handle.oauth.issuer}/register`
    );
    expect(
      parseJsonBody(requireRequest(registrationRequest, "registration request"))
    ).toMatchObject({
      client_name: "tiny-mcp-client integration test",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    });

    const authorizationRequest = harness.requests.find(
      (request) =>
        request.method === "GET" &&
        request.url.startsWith(`${harness.handle.oauth.issuer}/authorize`)
    );
    expect(
      new URL(requireRequest(authorizationRequest, "authorization request").url).searchParams.get(
        "resource"
      )
    ).toBe(harness.handle.mcpUrl);

    const tokenRequest = harness.requests.find((request) => {
      if (request.method !== "POST" || request.url !== `${harness.handle.oauth.issuer}/token`) {
        return false;
      }

      return parseFormBody(request).get("grant_type") === "authorization_code";
    });
    expect(
      parseFormBody(requireRequest(tokenRequest, "authorization-code token request")).get(
        "resource"
      )
    ).toBe(harness.handle.mcpUrl);

    const secondCallBaseline = summarizeTraffic(harness.requests, harness.handle);
    const secondResult = await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "second-call"
      }
    });

    expect(getTextContent(secondResult)).toBe("second-call");

    const summaryAfterSecondCall = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerSummaryAfterSecondCall = summarizeAuthorizationServerTraffic(
      harness.handle
    );
    expect(summaryAfterSecondCall.authorize - secondCallBaseline.authorize).toBe(0);
    expect(
      summaryAfterSecondCall.tokenAuthorizationCode - secondCallBaseline.tokenAuthorizationCode
    ).toBe(0);
    expect(summaryAfterSecondCall.tokenRefresh - secondCallBaseline.tokenRefresh).toBe(0);
    expect(summaryAfterSecondCall.mcpPost - secondCallBaseline.mcpPost).toBe(1);
    expect(authorizationServerSummaryAfterSecondCall).toEqual({
      authorize: 1,
      metadata: 1,
      register: 1,
      tokenAuthorizationCode: 1,
      tokenRefresh: 0
    });
  });

  it("skips DCR for a configured static client and still completes the PKCE flow", async () => {
    const loopbackServer = await createBoundLoopbackServerFactory("127.0.0.1");
    const redirectUri = `http://127.0.0.1:${loopbackServer.port}/callback`;
    const harness = await createHarness({
      createServer: loopbackServer.createServer,
      oauthClient: {
        mode: "static",
        clientId: "static-client"
      },
      serverOptions: {
        staticClients: [
          {
            clientId: "static-client",
            redirectUris: [redirectUri],
            scopes: ["mcp.read"]
          }
        ]
      }
    });
    cleanups.add(harness.close);

    await harness.client.connect(harness.transport);

    const result = await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "static-client"
      }
    });

    expect(getTextContent(result)).toBe("static-client");

    const summary = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerSummary = summarizeAuthorizationServerTraffic(harness.handle);
    expect(summary.register).toBe(0);
    expect(summary.authorize).toBe(1);
    expect(summary.tokenAuthorizationCode).toBe(1);
    expect(authorizationServerSummary).toEqual({
      authorize: 1,
      metadata: 1,
      register: 0,
      tokenAuthorizationCode: 1,
      tokenRefresh: 0
    });

    const authorizationRequest = harness.requests.find(
      (request) =>
        request.method === "GET" &&
        request.url.startsWith(`${harness.handle.oauth.issuer}/authorize`)
    );
    expect(
      new URL(requireRequest(authorizationRequest, "authorization request").url).searchParams.get(
        "client_id"
      )
    ).toBe("static-client");

    const tokenRequest = harness.requests.find((request) => {
      if (request.method !== "POST" || request.url !== `${harness.handle.oauth.issuer}/token`) {
        return false;
      }

      return parseFormBody(request).get("grant_type") === "authorization_code";
    });
    expect(
      parseFormBody(requireRequest(tokenRequest, "authorization-code token request")).get(
        "client_id"
      )
    ).toBe("static-client");
  });

  it("refreshes once after the current access token is revoked and the MCP server returns invalid_token", async () => {
    const harness = await createHarness();
    cleanups.add(harness.close);

    await harness.client.connect(harness.transport);
    await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "before-revoke"
      }
    });

    const initialSession = getStoredSession(harness);
    expect(initialSession.tokens?.accessToken).toBeTruthy();
    const revokedAccessToken = initialSession.tokens?.accessToken ?? "";
    harness.handle.oauth.revoke(revokedAccessToken);

    const baseline = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerBaseline = summarizeAuthorizationServerTraffic(harness.handle);
    const refreshedResult = await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "after-revoke"
      }
    });

    expect(getTextContent(refreshedResult)).toBe("after-revoke");

    const summary = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerSummary = summarizeAuthorizationServerTraffic(harness.handle);
    expect(summary.authorize - baseline.authorize).toBe(0);
    expect(summary.tokenRefresh - baseline.tokenRefresh).toBe(1);
    expect(summary.mcpPost - baseline.mcpPost).toBe(2);
    expect(authorizationServerSummary.tokenRefresh - authorizationServerBaseline.tokenRefresh).toBe(
      1
    );

    const refreshRequest = findLastRequest(
      harness.requests,
      (request) => {
        if (request.method !== "POST" || request.url !== `${harness.handle.oauth.issuer}/token`) {
          return false;
        }

        return parseFormBody(request).get("grant_type") === "refresh_token";
      },
      "refresh token request"
    );
    expect(parseFormBody(refreshRequest).get("resource")).toBe(harness.handle.mcpUrl);

    const updatedSession = getStoredSession(harness);
    expect(updatedSession.tokens?.accessToken).toBeTruthy();
    expect(updatedSession.tokens?.accessToken).not.toBe(revokedAccessToken);
  });

  it("deduplicates concurrent refreshes when multiple calls race on an expired token", async () => {
    const harness = await createHarness();
    cleanups.add(harness.close);

    await harness.client.connect(harness.transport);
    await harness.client.callTool({
      name: "echo",
      arguments: {
        text: "seed-token"
      }
    });

    harness.setNow(80_000);
    const baseline = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerBaseline = summarizeAuthorizationServerTraffic(harness.handle);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        harness.client.callTool({
          name: "echo",
          arguments: {
            text: `parallel-${index}`
          }
        })
      )
    );

    expect(results.map(getTextContent)).toEqual([
      "parallel-0",
      "parallel-1",
      "parallel-2",
      "parallel-3",
      "parallel-4"
    ]);

    const summary = summarizeTraffic(harness.requests, harness.handle);
    const authorizationServerSummary = summarizeAuthorizationServerTraffic(harness.handle);
    expect(summary.authorize - baseline.authorize).toBe(0);
    expect(summary.tokenRefresh - baseline.tokenRefresh).toBe(1);
    expect(summary.mcpPost - baseline.mcpPost).toBe(5);
    expect(authorizationServerSummary.tokenRefresh - authorizationServerBaseline.tokenRefresh).toBe(
      1
    );
  });

  it("maps verifier audience mismatches to a typed OAuthError instead of a generic transport error", async () => {
    const harness = await createHarness({
      responseTransform: async ({ handle, record, response }) => {
        if (
          record.method !== "POST" ||
          record.url !== `${handle.oauth.issuer}/token` ||
          parseFormBody(record).get("grant_type") !== "authorization_code"
        ) {
          return undefined;
        }

        const payload = (await response.clone().json()) as Record<string, unknown>;
        const wrongAudienceToken = await handle.oauth.issueTokenFor({
          clientId: parseFormBody(record).get("client_id") ?? "unknown-client",
          resource: `${handle.mcpUrl}/wrong-audience`,
          scopes: ["mcp.read"]
        });

        payload.access_token = wrongAudienceToken;
        delete payload.refresh_token;

        return cloneResponse(response, JSON.stringify(payload));
      }
    });
    cleanups.add(harness.close);

    let caughtError: unknown;

    try {
      await harness.client.connect(harness.transport);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(OAuthError);
    expect(caughtError).toMatchObject({
      error: "invalid_token",
      errorDescription: "audience mismatch",
      status: 401
    });
    expect((caughtError as Error).message).toBe("audience mismatch");
  });

  it("maps insufficient_scope bearer challenges to a typed OAuthError", async () => {
    const harness = await createHarness({
      responseTransform: async ({ handle, record, response }) => {
        if (
          record.method !== "POST" ||
          record.url !== `${handle.oauth.issuer}/token` ||
          parseFormBody(record).get("grant_type") !== "authorization_code"
        ) {
          return undefined;
        }

        const payload = (await response.clone().json()) as Record<string, unknown>;
        const insufficientScopeToken = await handle.oauth.issueTokenFor({
          clientId: parseFormBody(record).get("client_id") ?? "unknown-client",
          resource: handle.mcpUrl,
          scopes: ["mcp.write"]
        });

        payload.access_token = insufficientScopeToken;
        delete payload.refresh_token;

        return cloneResponse(response, JSON.stringify(payload));
      }
    });
    cleanups.add(harness.close);

    let caughtError: unknown;

    try {
      await harness.client.connect(harness.transport);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(OAuthError);
    expect(caughtError).toMatchObject({
      error: "insufficient_scope",
      errorDescription: "insufficient scope",
      status: 403
    });
    expect((caughtError as Error).message).toBe("insufficient scope");
  });
});
