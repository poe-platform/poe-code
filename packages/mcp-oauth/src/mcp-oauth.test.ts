import crypto from "node:crypto";
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  createAuthStoreSessionStore,
  createDefaultOAuthClientProvider,
  type OAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession,
} from "./index.js";

const RESOURCE_URL = "https://resource.example.com/mcp";
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
  discovery = createDiscoveryResult()
): Promise<void> {
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
