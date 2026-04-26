import crypto from "node:crypto";
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  createAuthStoreSessionStore,
  createDefaultOAuthClientProvider,
  OAuthError,
  type OAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession,
} from "./index.js";

const RESOURCE_URL = "https://resource.example.com/mcp";
const NON_CANONICAL_RESOURCE_URL = "HTTPS://RESOURCE.EXAMPLE.COM:443/mcp#ignored";
const RESOURCE_METADATA_URL =
  "https://resource.example.com/.well-known/oauth-protected-resource/mcp";
const AUTHORIZATION_SERVER = "https://auth.example.com";
const AUTHORIZATION_SERVER_METADATA_URL =
  "https://auth.example.com/.well-known/oauth-authorization-server";
const AUTHORIZATION_ENDPOINT = "https://auth.example.com/authorize";
const TOKEN_ENDPOINT = "https://auth.example.com/token";
const REGISTRATION_ENDPOINT = "https://auth.example.com/register";

function createDiscoveryResult(
  overrides: Partial<OAuthDiscoveryResult> = {}
): OAuthDiscoveryResult {
  return {
    resource: RESOURCE_URL,
    resourceMetadataUrl: RESOURCE_METADATA_URL,
    resourceMetadata: {
      resource: RESOURCE_URL,
      authorization_servers: [AUTHORIZATION_SERVER],
    },
    authorizationServer: AUTHORIZATION_SERVER,
    authorizationServerMetadataUrl: AUTHORIZATION_SERVER_METADATA_URL,
    authorizationServerMetadata: {
      issuer: AUTHORIZATION_SERVER,
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
      token_endpoint: TOKEN_ENDPOINT,
      registration_endpoint: REGISTRATION_ENDPOINT,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
    ...overrides,
  };
}

function createMemorySessionStore(): OAuthSessionStore & { sessions: Map<string, StoredOAuthSession> } {
  const sessions = new Map<string, StoredOAuthSession>();

  return {
    sessions,
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

type MemFsPromises = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir?(path: string): Promise<string[]>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void | string | undefined>;
  unlink(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
};

function createAuthStoreConfig(fs: MemFsPromises) {
  return {
    backend: "file" as const,
    fileStore: {
      fs,
      salt: "poe-code:test:mcp-oauth:v1",
      defaultDirectory: ".test-mcp-oauth",
      getHomeDirectory: () => "/home/test",
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" }),
    },
  };
}

function createCallbackResponse(code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createOAuthPair(options: { includeRegistrationEndpoint?: boolean } = {}) {
  const includeRegistrationEndpoint = options.includeRegistrationEndpoint ?? true;
  const registeredClientIds = new Set<string>();
  const registeredRedirectUris = new Map<string, string[]>();
  const authorizationRequests: URL[] = [];
  const registrationBodies: Array<Record<string, unknown>> = [];
  const tokenBodies: URLSearchParams[] = [];
  const resourceAuthorizations: Array<string | null> = [];
  const issuedAccessTokens = new Set<string>();
  const validRefreshTokens = new Set<string>();
  const authorizationCodes = new Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      resource: string;
      codeChallenge: string;
    }
  >();

  let clientCounter = 0;
  let authorizationCounter = 0;
  let tokenCounter = 0;

  const issueTokens = () => {
    tokenCounter += 1;
    const accessToken = `access-${tokenCounter}`;
    const refreshToken = `refresh-${tokenCounter}`;
    issuedAccessTokens.add(accessToken);
    validRefreshTokens.add(refreshToken);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    };
  };

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const method = init?.method ?? "GET";

    if (url === RESOURCE_METADATA_URL) {
      return new Response(
        JSON.stringify({
          resource: RESOURCE_URL,
          authorization_servers: [AUTHORIZATION_SERVER],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url === AUTHORIZATION_SERVER_METADATA_URL) {
      return new Response(
        JSON.stringify({
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          registration_endpoint: includeRegistrationEndpoint ? REGISTRATION_ENDPOINT : undefined,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url === REGISTRATION_ENDPOINT) {
      const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      registrationBodies.push(parsedBody);

      clientCounter += 1;
      const clientId = `client-${clientCounter}`;
      registeredClientIds.add(clientId);
      registeredRedirectUris.set(
        clientId,
        Array.isArray(parsedBody.redirect_uris)
          ? parsedBody.redirect_uris.filter((value): value is string => typeof value === "string")
          : []
      );

      return new Response(
        JSON.stringify({
          client_id: clientId,
          token_endpoint_auth_method: "none",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url === TOKEN_ENDPOINT) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      tokenBodies.push(body);
      const grantType = body.get("grant_type");

      if (grantType === "authorization_code") {
        const code = body.get("code");
        if (code === null) {
          throw new Error("Missing authorization code");
        }

        const storedCode = authorizationCodes.get(code);
        if (!storedCode) {
          return new Response(
            JSON.stringify({ error: "invalid_grant" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        authorizationCodes.delete(code);

        expect(body.get("resource")).toBe(RESOURCE_URL);
        expect(body.get("redirect_uri")).toBe(storedCode.redirectUri);
        expect(body.get("client_id")).toBe(storedCode.clientId);
        expect(
          createS256CodeChallenge(body.get("code_verifier") ?? "")
        ).toBe(storedCode.codeChallenge);

        return new Response(JSON.stringify(issueTokens()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = body.get("refresh_token");
        if (refreshToken === null || !validRefreshTokens.has(refreshToken)) {
          return new Response(
            JSON.stringify({ error: "invalid_grant" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        validRefreshTokens.delete(refreshToken);
        expect(body.get("resource")).toBe(RESOURCE_URL);

        return new Response(JSON.stringify(issueTokens()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected token grant type: ${grantType}`);
    }

    if (url === RESOURCE_URL && method === "POST") {
      const headers = new Headers(init?.headers);
      const authorization = headers.get("Authorization");
      resourceAuthorizations.push(authorization);

      if (authorization === null) {
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              `Bearer realm="mcp", error="invalid_token", ` +
              `resource_metadata="${RESOURCE_METADATA_URL}"`,
          },
        });
      }

      const bearerPrefix = "Bearer ";
      const accessToken = authorization.startsWith(bearerPrefix)
        ? authorization.slice(bearerPrefix.length)
        : authorization;

      if (!issuedAccessTokens.has(accessToken)) {
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              `Bearer realm="mcp", error="invalid_token", ` +
              `resource_metadata="${RESOURCE_METADATA_URL}"`,
          },
        });
      }

      return createCallbackResponse(accessToken);
    }

    throw new Error(`Unexpected fetch request: ${method} ${url}`);
  });

  const openBrowser = vi.fn(async (authorizationUrl: string) => {
    const url = new URL(authorizationUrl);
    authorizationRequests.push(url);

    const clientId = url.searchParams.get("client_id");
    if (clientId === null) {
      throw new Error("Missing client_id");
    }

    if (
      registeredClientIds.size > 0 &&
      !registeredClientIds.has(clientId) &&
      clientId !== "static-client"
    ) {
      throw new Error(`Unknown client ID: ${clientId}`);
    }

    const redirectUri = url.searchParams.get("redirect_uri");
    if (redirectUri === null) {
      throw new Error("Missing redirect_uri");
    }

    if (clientId !== "static-client") {
      const clientRedirectUris = registeredRedirectUris.get(clientId) ?? [];
      if (!clientRedirectUris.some((candidate) => matchesRegisteredLoopbackRedirect(candidate, redirectUri))) {
        throw new Error(`redirect_uri ${redirectUri} does not match the registered loopback path`);
      }
    }

    authorizationCounter += 1;
    const code = `code-${authorizationCounter}`;
    authorizationCodes.set(code, {
      clientId,
      redirectUri,
      resource: url.searchParams.get("resource") ?? "",
      codeChallenge: url.searchParams.get("code_challenge") ?? "",
    });

    await requestLoopbackCallback(`${redirectUri}?code=${encodeURIComponent(code)}`);
  });

  return {
    fetchMock,
    openBrowser,
    authorizationRequests,
    registrationBodies,
    tokenBodies,
    resourceAuthorizations,
  };
}

async function requestLoopbackCallback(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.once("end", resolve);
    });
    request.once("error", reject);
  });
}

function createS256CodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function matchesRegisteredLoopbackRedirect(registered: string, requested: string): boolean {
  const registeredUrl = new URL(registered);
  const requestedUrl = new URL(requested);

  registeredUrl.port = "";
  requestedUrl.port = "";
  return registeredUrl.toString() === requestedUrl.toString();
}

async function authorizeProvider(
  provider: OAuthClientProvider,
  fetchMock: typeof fetch,
  discovery = createDiscoveryResult(),
  requestUrl = RESOURCE_URL
): Promise<void> {
  const result = await provider.handleUnauthorized({
    requestUrl: new URL(requestUrl),
    response: new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate":
          `Bearer realm="mcp", error="invalid_token", ` +
          `resource_metadata="${RESOURCE_METADATA_URL}"`,
      },
    }),
    challenge: {
      scheme: "Bearer",
      raw: "",
      params: {
        error: "invalid_token",
        resource_metadata: RESOURCE_METADATA_URL,
      },
    },
    discovery,
    fetch: fetchMock,
  });

  expect(result).toEqual({ action: "retry" });
}

describe("createAuthStoreSessionStore", () => {
  it("round-trips tokens and client registration through auth-store", async () => {
    const fs = createFsFromVolume(new Volume()).promises as {
      readFile(path: string, encoding: BufferEncoding): Promise<string>;
      writeFile(
        path: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding }
      ): Promise<void>;
      mkdir(
        path: string,
        options?: { recursive?: boolean }
      ): Promise<void | string | undefined>;
      unlink(path: string): Promise<void>;
      chmod(path: string, mode: number): Promise<void>;
    };

    const sessionStore = createAuthStoreSessionStore({
      backend: "file",
      fileStore: {
        fs,
        salt: "poe-code:test:mcp-oauth:v1",
        defaultDirectory: ".test-mcp-oauth",
        getHomeDirectory: () => "/home/test",
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" }),
      },
    });

    const session: StoredOAuthSession = {
      resource: RESOURCE_URL,
      authorizationServer: AUTHORIZATION_SERVER,
      client: {
        clientId: "client-1",
      },
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenType: "Bearer",
        expiresAt: 123_456,
      },
      discovery: {
        resourceMetadataUrl: RESOURCE_METADATA_URL,
        resourceMetadata: {
          resource: RESOURCE_URL,
          authorization_servers: [AUTHORIZATION_SERVER],
        },
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      },
    };

    await sessionStore.save(RESOURCE_URL, session);

    expect(await sessionStore.load(RESOURCE_URL)).toEqual(session);

    await sessionStore.clear(RESOURCE_URL);
    expect(await sessionStore.load(RESOURCE_URL)).toBeNull();
  });

  it("stores session files under a canonical hashed key without plaintext tokens or resource URIs", async () => {
    const fs = createFsFromVolume(new Volume()).promises as {
      readFile(path: string, encoding: BufferEncoding): Promise<string>;
      readdir(path: string): Promise<string[]>;
      writeFile(
        path: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding }
      ): Promise<void>;
      mkdir(
        path: string,
        options?: { recursive?: boolean }
      ): Promise<void | string | undefined>;
      unlink(path: string): Promise<void>;
      chmod(path: string, mode: number): Promise<void>;
    };

    const sessionStore = createAuthStoreSessionStore({
      backend: "file",
      fileStore: {
        fs,
        salt: "poe-code:test:mcp-oauth:v1",
        defaultDirectory: ".test-mcp-oauth",
        getHomeDirectory: () => "/home/test",
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" }),
      },
    });

    const session: StoredOAuthSession = {
      resource: RESOURCE_URL,
      authorizationServer: AUTHORIZATION_SERVER,
      client: {
        clientId: "client-1",
      },
      tokens: {
        accessToken: "access-sensitive-token",
        refreshToken: "refresh-sensitive-token",
        tokenType: "Bearer",
        expiresAt: 123_456,
      },
      discovery: {
        resourceMetadataUrl: RESOURCE_METADATA_URL,
        resourceMetadata: {
          resource: RESOURCE_URL,
          authorization_servers: [AUTHORIZATION_SERVER],
        },
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      },
    };

    await sessionStore.save(NON_CANONICAL_RESOURCE_URL, session);

    const directoryEntries = await fs.readdir("/home/test/.test-mcp-oauth");
    expect(directoryEntries).toHaveLength(1);
    expect(directoryEntries[0]).toMatch(/^[a-f0-9]{64}\.enc$/);
    expect(directoryEntries[0]).not.toContain("resource.example.com");
    expect(directoryEntries[0]).not.toContain("access-sensitive-token");
    expect(directoryEntries[0]).not.toContain("refresh-sensitive-token");

    const storedPayload = await fs.readFile(
      `/home/test/.test-mcp-oauth/${directoryEntries[0]}`,
      "utf8"
    );
    expect(storedPayload).not.toContain(RESOURCE_URL);
    expect(storedPayload).not.toContain("access-sensitive-token");
    expect(storedPayload).not.toContain("refresh-sensitive-token");
    expect(await sessionStore.load(RESOURCE_URL)).toEqual(session);
  });

  it("keys sessions by the canonical resource URI", async () => {
    const fs = createFsFromVolume(new Volume()).promises as {
      readFile(path: string, encoding: BufferEncoding): Promise<string>;
      writeFile(
        path: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding }
      ): Promise<void>;
      mkdir(
        path: string,
        options?: { recursive?: boolean }
      ): Promise<void | string | undefined>;
      unlink(path: string): Promise<void>;
      chmod(path: string, mode: number): Promise<void>;
    };

    const sessionStore = createAuthStoreSessionStore({
      backend: "file",
      fileStore: {
        fs,
        salt: "poe-code:test:mcp-oauth:v1",
        defaultDirectory: ".test-mcp-oauth",
        getHomeDirectory: () => "/home/test",
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" }),
      },
    });

    const session: StoredOAuthSession = {
      resource: RESOURCE_URL,
      authorizationServer: AUTHORIZATION_SERVER,
      client: {
        clientId: "client-1",
      },
      discovery: {
        resourceMetadataUrl: RESOURCE_METADATA_URL,
        resourceMetadata: {
          resource: RESOURCE_URL,
          authorization_servers: [AUTHORIZATION_SERVER],
        },
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      },
    };

    await sessionStore.save(NON_CANONICAL_RESOURCE_URL, session);

    expect(await sessionStore.load(RESOURCE_URL)).toEqual(session);
    expect(await sessionStore.load(NON_CANONICAL_RESOURCE_URL)).toEqual(session);
  });
});

describe("createDefaultOAuthClientProvider", () => {
  it("fails before authorization when the server metadata does not advertise S256", async () => {
    const pair = createOAuthPair();
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      now: () => 10_000,
    });

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
      }),
      challenge: null,
      discovery: createDiscoveryResult({
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          registration_endpoint: REGISTRATION_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["plain"],
        },
      }),
      fetch: pair.fetchMock as typeof fetch,
    });

    expect(result.action).toBe("fail");
    if (result.action === "fail") {
      expect(result.error?.message).toContain("S256");
    }
    expect(pair.openBrowser).not.toHaveBeenCalled();
    expect(pair.tokenBodies).toHaveLength(0);
  });

  it("still picks S256 and a fixed 127.0.0.1 /callback redirect when plain is also advertised", async () => {
    const pair = createOAuthPair();
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      now: () => 10_000,
    });

    await authorizeProvider(
      provider,
      pair.fetchMock as typeof fetch,
      createDiscoveryResult({
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          registration_endpoint: REGISTRATION_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["plain", "S256"],
        },
      })
    );

    expect(pair.registrationBodies).toHaveLength(1);
    const registeredRedirectUris = pair.registrationBodies[0]?.redirect_uris;
    expect(Array.isArray(registeredRedirectUris)).toBe(true);
    const registeredRedirectUri = new URL(String((registeredRedirectUris as string[])[0]));
    expect(registeredRedirectUri.protocol).toBe("http:");
    expect(registeredRedirectUri.hostname).toBe("127.0.0.1");
    expect(registeredRedirectUri.pathname).toBe("/callback");

    expect(pair.authorizationRequests).toHaveLength(1);
    const authorizationRequest = pair.authorizationRequests[0];
    expect(authorizationRequest?.searchParams.get("code_challenge_method")).toBe("S256");
    const runtimeRedirectUri = new URL(authorizationRequest?.searchParams.get("redirect_uri") ?? "");
    expect(runtimeRedirectUri.protocol).toBe("http:");
    expect(runtimeRedirectUri.hostname).toBe("127.0.0.1");
    expect(runtimeRedirectUri.pathname).toBe("/callback");
  });

  it("skips DCR for static clients and sends the resource indicator on authorize and token requests", async () => {
    const pair = createOAuthPair({
      includeRegistrationEndpoint: true,
    });
    const sessionStore = createMemorySessionStore();
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "static",
        clientId: "static-client",
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider, pair.fetchMock as typeof fetch);

    expect(pair.registrationBodies).toHaveLength(0);
    expect(pair.authorizationRequests).toHaveLength(1);
    expect(pair.authorizationRequests[0]?.searchParams.get("redirect_uri")).toContain("http://127.0.0.1:");
    expect(pair.authorizationRequests[0]?.searchParams.get("resource")).toBe(RESOURCE_URL);
    expect(pair.tokenBodies).toHaveLength(1);
    expect(pair.tokenBodies[0]?.get("resource")).toBe(RESOURCE_URL);
    expect(await sessionStore.load(RESOURCE_URL)).toMatchObject({
      client: {
        clientId: "static-client",
      },
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
      },
    });
  });

  it("canonicalizes the resource indicator across request mapping, authorize, code exchange, and refresh", async () => {
    const pair = createOAuthPair({
      includeRegistrationEndpoint: true,
    });
    const sessionStore = createMemorySessionStore();
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "static",
        clientId: "static-client",
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore,
      now: () => 10_000,
    });

    const nonCanonicalDiscovery = createDiscoveryResult({
      resource: NON_CANONICAL_RESOURCE_URL,
      resourceMetadata: {
        resource: NON_CANONICAL_RESOURCE_URL,
        authorization_servers: [AUTHORIZATION_SERVER],
      },
    });

    await authorizeProvider(
      provider,
      pair.fetchMock as typeof fetch,
      nonCanonicalDiscovery,
      NON_CANONICAL_RESOURCE_URL
    );

    expect(pair.authorizationRequests).toHaveLength(1);
    expect(pair.authorizationRequests[0]?.searchParams.get("resource")).toBe(RESOURCE_URL);
    expect(pair.tokenBodies).toHaveLength(1);
    expect(pair.tokenBodies[0]?.get("resource")).toBe(RESOURCE_URL);

    const headers = new Headers();
    await provider.authorizeRequest({
      requestUrl: new URL(RESOURCE_URL),
      headers,
      fetch: pair.fetchMock as typeof fetch,
    });

    expect(headers.get("Authorization")).toBe("Bearer access-1");

    const refreshResult = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            `Bearer realm="mcp", error="invalid_token", ` +
            `resource_metadata="${RESOURCE_METADATA_URL}"`,
        },
      }),
      challenge: {
        scheme: "Bearer",
        raw: "",
        params: {
          error: "invalid_token",
          resource_metadata: RESOURCE_METADATA_URL,
        },
      },
      discovery: nonCanonicalDiscovery,
      fetch: pair.fetchMock as typeof fetch,
    });

    expect(refreshResult).toEqual({ action: "retry" });
    expect(
      pair.tokenBodies.filter((body) => body.get("grant_type") === "refresh_token")
    ).toHaveLength(1);
    expect(
      pair.tokenBodies.filter((body) => body.get("grant_type") === "refresh_token")[0]?.get("resource")
    ).toBe(RESOURCE_URL);

    const refreshedHeaders = new Headers();
    await provider.authorizeRequest({
      requestUrl: new URL(NON_CANONICAL_RESOURCE_URL),
      headers: refreshedHeaders,
      fetch: pair.fetchMock as typeof fetch,
    });

    expect(refreshedHeaders.get("Authorization")).toBe("Bearer access-2");
    expect(await sessionStore.load(RESOURCE_URL)).toMatchObject({
      resource: RESOURCE_URL,
      tokens: {
        accessToken: "access-2",
      },
    });
  });

  it("reloads persisted tokens and refreshes them only once for concurrent callers", async () => {
    const pair = createOAuthPair();
    const sessionStore = createMemorySessionStore();
    let currentTime = 10_000;
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore,
      now: () => currentTime,
    });

    await authorizeProvider(provider, pair.fetchMock as typeof fetch);
    currentTime = 3_700_000;

    const authorizeCalls = await Promise.all([
      createAuthorizedHeaders(provider, pair.fetchMock as typeof fetch),
      createAuthorizedHeaders(provider, pair.fetchMock as typeof fetch),
      createAuthorizedHeaders(provider, pair.fetchMock as typeof fetch),
    ]);

    expect(new Set(authorizeCalls)).toEqual(new Set(["Bearer access-2"]));
    expect(
      pair.tokenBodies.filter((body) => body.get("grant_type") === "refresh_token")
    ).toHaveLength(1);
  });

  it("clears invalid refresh tokens, avoids echoing them, and falls back to one fresh authorization flow", async () => {
    const pair = createOAuthPair();
    const sessionStore = createMemorySessionStore();
    let currentTime = 10_000;
    let refreshFailures = 0;
    const refreshBodies: URLSearchParams[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "refresh_token" && refreshFailures === 0) {
          refreshFailures += 1;
          refreshBodies.push(body);
          return new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: `refresh token ${body.get("refresh_token")} is invalid`,
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      return pair.fetchMock(input, init);
    });
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore,
      now: () => currentTime,
    });

    await authorizeProvider(provider, fetchMock as typeof fetch);
    currentTime = 3_700_000;

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            `Bearer realm="mcp", error="invalid_token", ` +
            `resource_metadata="${RESOURCE_METADATA_URL}"`,
        },
      }),
      challenge: {
        scheme: "Bearer",
        raw: "",
        params: {
          error: "invalid_token",
          resource_metadata: RESOURCE_METADATA_URL,
        },
      },
      discovery: createDiscoveryResult(),
      fetch: fetchMock as typeof fetch,
    });

    expect(result).toEqual({ action: "retry" });
    expect(refreshFailures).toBe(1);
    expect(pair.openBrowser).toHaveBeenCalledTimes(2);
    expect(refreshBodies).toHaveLength(1);
    expect(refreshBodies[0]?.get("refresh_token")).toBe("refresh-1");
    expect(
      pair.tokenBodies.filter((body) => body.get("grant_type") === "authorization_code")
    ).toHaveLength(2);
    expect(await sessionStore.load(RESOURCE_URL)).toMatchObject({
      tokens: {
        accessToken: "access-2",
        refreshToken: "refresh-2",
      },
    });

    const authorizationHeader = await createAuthorizedHeaders(provider, fetchMock as typeof fetch);
    expect(authorizationHeader).toBe("Bearer access-2");
  });

  it("persists a dynamically registered client after a failed token exchange and reuses it on the next attempt", async () => {
    const sessionStore = createMemorySessionStore();
    const registrationBodies: Array<Record<string, unknown>> = [];
    const authorizationRequests: URL[] = [];
    const authorizationCodes = new Map<
      string,
      { clientId: string; redirectUri: string; codeChallenge: string }
    >();
    let authorizationCounter = 0;
    let tokenCounter = 0;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();

      if (url === REGISTRATION_ENDPOINT) {
        registrationBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

        return new Response(
          JSON.stringify({
            client_id: "client-1",
            token_endpoint_auth_method: "none",
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url === TOKEN_ENDPOINT) {
        tokenCounter += 1;
        const body = new URLSearchParams(String(init?.body ?? ""));
        const code = body.get("code");
        if (code === null) {
          throw new Error("Missing authorization code");
        }

        const authorizationCode = authorizationCodes.get(code);
        if (authorizationCode === undefined) {
          throw new Error(`Unknown authorization code: ${code}`);
        }

        expect(body.get("client_id")).toBe(authorizationCode.clientId);
        expect(body.get("redirect_uri")).toBe(authorizationCode.redirectUri);
        expect(
          createS256CodeChallenge(body.get("code_verifier") ?? "")
        ).toBe(authorizationCode.codeChallenge);

        if (tokenCounter === 1) {
          return new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "expired code",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            access_token: "access-2",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "refresh-2",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      throw new Error(`Unexpected fetch request: ${(init?.method ?? "GET")} ${url}`);
    });
    const openBrowser = vi.fn(async (authorizationUrl: string) => {
      const url = new URL(authorizationUrl);
      authorizationRequests.push(url);
      authorizationCounter += 1;

      const code = `code-${authorizationCounter}`;
      authorizationCodes.set(code, {
        clientId: url.searchParams.get("client_id") ?? "",
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
        codeChallenge: url.searchParams.get("code_challenge") ?? "",
      });

      await requestLoopbackCallback(`${url.searchParams.get("redirect_uri")}?code=${code}`);
    });
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser,
      },
      sessionStore,
      now: () => 10_000,
    });

    const firstAttempt = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
      }),
      challenge: null,
      discovery: createDiscoveryResult(),
      fetch: fetchMock as typeof fetch,
    });

    expect(firstAttempt.action).toBe("fail");
    const failedSession = await sessionStore.load(RESOURCE_URL);
    expect(failedSession).toMatchObject({
      client: {
        clientId: "client-1",
      },
    });
    expect(failedSession?.tokens).toBeUndefined();

    await authorizeProvider(provider, fetchMock as typeof fetch);

    expect(registrationBodies).toHaveLength(1);
    expect(authorizationRequests).toHaveLength(2);
    expect(
      new Set(
        authorizationRequests.map((request) => new URL(request.searchParams.get("redirect_uri") ?? "").port)
      ).size
    ).toBe(2);
    expect(await sessionStore.load(RESOURCE_URL)).toMatchObject({
      client: {
        clientId: "client-1",
      },
      tokens: {
        accessToken: "access-2",
        refreshToken: "refresh-2",
      },
    });
  });

  it("persists dynamically registered clients in auth-store by issuer and reuses them across runs", async () => {
    const fs = createFsFromVolume(new Volume()).promises as MemFsPromises;
    const authStore = createAuthStoreConfig(fs);
    const pair = createOAuthPair();

    const provider1 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
          scope: "mcp.read mcp.write",
          softwareId: "poe-code",
          softwareVersion: "1.0.0",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider1, pair.fetchMock as typeof fetch);

    const provider2 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
          scope: "mcp.read mcp.write",
          softwareId: "poe-code",
          softwareVersion: "1.0.0",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider2, pair.fetchMock as typeof fetch);

    expect(pair.registrationBodies).toHaveLength(1);
    expect(pair.registrationBodies[0]).toMatchObject({
      client_name: "poe-code test",
      redirect_uris: [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp.read mcp.write",
      software_id: "poe-code",
      software_version: "1.0.0",
    });
    expect(pair.authorizationRequests).toHaveLength(2);
    expect(pair.authorizationRequests[0]?.searchParams.get("client_id")).toBe("client-1");
    expect(pair.authorizationRequests[1]?.searchParams.get("client_id")).toBe("client-1");
  });

  it("falls back to a configured static client_id when registration_endpoint is missing", async () => {
    const pair = createOAuthPair({
      includeRegistrationEndpoint: false,
    });
    const sessionStore = createMemorySessionStore();
    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        clientId: "static-client",
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore,
      now: () => 10_000,
    });

    await authorizeProvider(
      provider,
      pair.fetchMock as typeof fetch,
      createDiscoveryResult({
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      })
    );

    expect(pair.registrationBodies).toHaveLength(0);
    expect(pair.authorizationRequests).toHaveLength(1);
    expect(pair.authorizationRequests[0]?.searchParams.get("client_id")).toBe("static-client");
    expect(await sessionStore.load(RESOURCE_URL)).toMatchObject({
      client: {
        clientId: "static-client",
      },
      tokens: {
        accessToken: "access-1",
      },
    });
  });

  it("prefers a configured static client_id over a stored dynamic registration when registration_endpoint is missing", async () => {
    const fs = createFsFromVolume(new Volume()).promises as MemFsPromises;
    const authStore = createAuthStoreConfig(fs);
    const registrationPair = createOAuthPair();

    const provider1 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: registrationPair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider1, registrationPair.fetchMock as typeof fetch);

    const fallbackPair = createOAuthPair({
      includeRegistrationEndpoint: false,
    });
    const provider2 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        clientId: "static-client",
      },
      browser: {
        openBrowser: fallbackPair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(
      provider2,
      fallbackPair.fetchMock as typeof fetch,
      createDiscoveryResult({
        authorizationServerMetadata: {
          issuer: AUTHORIZATION_SERVER,
          authorization_endpoint: AUTHORIZATION_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      })
    );

    expect(fallbackPair.registrationBodies).toHaveLength(0);
    expect(fallbackPair.authorizationRequests).toHaveLength(1);
    expect(fallbackPair.authorizationRequests[0]?.searchParams.get("client_id")).toBe("static-client");
  });

  it("surfaces dynamic client registration endpoint errors as OAuthError", async () => {
    const pair = createOAuthPair();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (input.toString() === REGISTRATION_ENDPOINT) {
        return new Response(
          JSON.stringify({
            error: "invalid_client_metadata",
            error_description: "token_endpoint_auth_method client_secret_basic is not supported",
            error_uri: "https://errors.example.com/invalid_client_metadata",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return pair.fetchMock(input, init);
    });

    const provider = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      now: () => 10_000,
    });

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
      }),
      challenge: null,
      discovery: createDiscoveryResult(),
      fetch: fetchMock as typeof fetch,
    });

    expect(result.action).toBe("fail");
    if (result.action === "fail") {
      expect(result.error).toBeInstanceOf(OAuthError);
      expect(result.error).toMatchObject({
        error: "invalid_client_metadata",
        errorDescription: "token_endpoint_auth_method client_secret_basic is not supported",
        errorUri: "https://errors.example.com/invalid_client_metadata",
        status: 400,
        retryable: false,
        terminal: true,
      });
    }
    expect(pair.authorizationRequests).toHaveLength(0);
  });

  it("clears a stored dynamic client after invalid_client, re-registers once, and succeeds with the new client_id", async () => {
    const fs = createFsFromVolume(new Volume()).promises as MemFsPromises;
    const authStore = createAuthStoreConfig(fs);
    const pair = createOAuthPair();
    let rejectStoredClient = false;
    let authorizationCodeTokenAttempts = 0;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "authorization_code") {
          authorizationCodeTokenAttempts += 1;
        }
        if (
          rejectStoredClient
          && body.get("grant_type") === "authorization_code"
          && body.get("client_id") === "client-1"
        ) {
          rejectStoredClient = false;
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "stored client registration was revoked",
              error_uri: "https://errors.example.com/invalid_client",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      return pair.fetchMock(input, init);
    });

    const provider1 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider1, fetchMock as typeof fetch);
    rejectStoredClient = true;

    const provider2 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider2, fetchMock as typeof fetch);

    expect(pair.registrationBodies).toHaveLength(2);
    expect(pair.authorizationRequests).toHaveLength(3);
    expect(pair.authorizationRequests[1]?.searchParams.get("client_id")).toBe("client-1");
    expect(pair.authorizationRequests[2]?.searchParams.get("client_id")).toBe("client-2");
    expect(authorizationCodeTokenAttempts).toBe(3);
  });

  it("re-registers only once after invalid_client and then fails", async () => {
    const fs = createFsFromVolume(new Volume()).promises as MemFsPromises;
    const authStore = createAuthStoreConfig(fs);
    const pair = createOAuthPair();
    let authorizationCodeTokenAttempts = 0;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "authorization_code") {
          authorizationCodeTokenAttempts += 1;
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: `client ${body.get("client_id")} is rejected`,
              error_uri: "https://errors.example.com/invalid_client",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      return pair.fetchMock(input, init);
    });

    const provider1 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    await authorizeProvider(provider1, pair.fetchMock as typeof fetch);

    const provider2 = createDefaultOAuthClientProvider({
      client: {
        mode: "dynamic",
        metadata: {
          clientName: "poe-code test",
        },
      },
      browser: {
        openBrowser: pair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      authStore,
      now: () => 10_000,
    });

    const result = await provider2.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
      }),
      challenge: null,
      discovery: createDiscoveryResult(),
      fetch: fetchMock as typeof fetch,
    });

    expect(result.action).toBe("fail");
    if (result.action === "fail") {
      expect(result.error).toBeInstanceOf(OAuthError);
      expect(result.error).toMatchObject({
        error: "invalid_client",
        errorDescription: "client client-2 is rejected",
        status: 401,
        retryable: false,
        terminal: true,
      });
    }
    expect(pair.registrationBodies).toHaveLength(2);
    expect(pair.authorizationRequests).toHaveLength(3);
    expect(pair.authorizationRequests[0]?.searchParams.get("client_id")).toBe("client-1");
    expect(pair.authorizationRequests[1]?.searchParams.get("client_id")).toBe("client-1");
    expect(pair.authorizationRequests[2]?.searchParams.get("client_id")).toBe("client-2");
    expect(authorizationCodeTokenAttempts).toBe(2);
  });

  it("surfaces every token endpoint OAuth error code as OAuthError", async () => {
    const cases = [
      { error: "invalid_request", status: 400, retries: 1 },
      { error: "invalid_client", status: 401, retries: 1 },
      { error: "invalid_grant", status: 400, retries: 1 },
      { error: "unauthorized_client", status: 400, retries: 1 },
      { error: "unsupported_grant_type", status: 400, retries: 1 },
      { error: "invalid_scope", status: 400, retries: 1 },
      { error: "server_error", status: 500, retries: 2 },
      { error: "temporarily_unavailable", status: 503, retries: 2 },
    ] as const;

    for (const testCase of cases) {
      const pair = createOAuthPair();
      let tokenAttempts = 0;
      const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
        if (input.toString() === TOKEN_ENDPOINT) {
          const body = new URLSearchParams(String(init?.body ?? ""));
          if (body.get("grant_type") === "authorization_code") {
            tokenAttempts += 1;
            return new Response(
              JSON.stringify({
                error: testCase.error,
                error_description: `${testCase.error} description`,
                error_uri: `https://errors.example.com/${testCase.error}`,
              }),
              {
                status: testCase.status,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
        }

        return pair.fetchMock(input, init);
      });

      const provider = createDefaultOAuthClientProvider({
        client: {
          mode: "static",
          clientId: "static-client",
        },
        browser: {
          openBrowser: pair.openBrowser,
        },
        sessionStore: createMemorySessionStore(),
        now: () => 10_000,
      });

      const result = await provider.handleUnauthorized({
        requestUrl: new URL(RESOURCE_URL),
        response: new Response(null, {
          status: 401,
        }),
        challenge: null,
        discovery: createDiscoveryResult(),
        fetch: fetchMock as typeof fetch,
      });

      expect(result.action).toBe("fail");
      if (result.action === "fail") {
        expect(result.error).toBeInstanceOf(OAuthError);
        expect(result.error).toMatchObject({
          error: testCase.error,
          errorDescription: `${testCase.error} description`,
          errorUri: `https://errors.example.com/${testCase.error}`,
          error_description: `${testCase.error} description`,
          error_uri: `https://errors.example.com/${testCase.error}`,
          status: testCase.status,
        });
      }
      expect(tokenAttempts).toBe(testCase.retries);
    }
  });

  it("retries transient authorization server failures once and does not retry terminal OAuth errors", async () => {
    const transientPair = createOAuthPair();
    let transientAttempts = 0;
    const transientFetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (input.toString() === TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "authorization_code") {
          transientAttempts += 1;
          if (transientAttempts === 1) {
            return new Response(
              JSON.stringify({
                error: "server_error",
                error_description: "temporary authorization server failure",
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
        }
      }

      return transientPair.fetchMock(input, init);
    });

    const transientProvider = createDefaultOAuthClientProvider({
      client: {
        mode: "static",
        clientId: "static-client",
      },
      browser: {
        openBrowser: transientPair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      now: () => 10_000,
    });

    await authorizeProvider(transientProvider, transientFetchMock as typeof fetch);
    expect(transientAttempts).toBe(2);
    expect(transientPair.authorizationRequests).toHaveLength(2);

    const terminalPair = createOAuthPair();
    let terminalAttempts = 0;
    const terminalFetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (input.toString() === TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "authorization_code") {
          terminalAttempts += 1;
          return new Response(
            JSON.stringify({
              error: "invalid_scope",
              error_description: "requested scope is not allowed",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      return terminalPair.fetchMock(input, init);
    });

    const terminalProvider = createDefaultOAuthClientProvider({
      client: {
        mode: "static",
        clientId: "static-client",
      },
      browser: {
        openBrowser: terminalPair.openBrowser,
      },
      sessionStore: createMemorySessionStore(),
      now: () => 10_000,
    });

    const terminalResult = await terminalProvider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, {
        status: 401,
      }),
      challenge: null,
      discovery: createDiscoveryResult(),
      fetch: terminalFetchMock as typeof fetch,
    });

    expect(terminalResult.action).toBe("fail");
    expect(terminalAttempts).toBe(1);
    expect(terminalPair.authorizationRequests).toHaveLength(1);
  });
});

async function createAuthorizedHeaders(
  provider: OAuthClientProvider,
  fetchMock: typeof fetch
): Promise<string | null> {
  const headers = new Headers();
  await provider.authorizeRequest({
    requestUrl: new URL(RESOURCE_URL),
    headers,
    fetch: fetchMock,
  });
  return headers.get("Authorization");
}
