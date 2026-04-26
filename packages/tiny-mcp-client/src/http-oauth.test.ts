import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { OAuthSessionStore, StoredOAuthSession } from "mcp-oauth";
import {
  HttpTransport,
  type OAuthDiscoveryCache,
  type OAuthDiscoveryResult,
} from "./internal.js";
import { OAuthMetadataDiscovery, discoverOAuthMetadata } from "./oauth-discovery.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

describe("discoverOAuthMetadata", () => {
  it("resolves protected resource and authorization server metadata, then reuses injected cache", async () => {
    const resourceUrl = "https://resource.example.com/tenant/mcp";
    const resourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
    const failingAuthorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";
    const successfulAuthorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-b";

    const sharedCacheStore = new Map<string, OAuthDiscoveryResult>();
    const cache: OAuthDiscoveryCache = {
      get: vi.fn(async (key: string) => sharedCacheStore.get(key)),
      set: vi.fn(async (key: string, value: OAuthDiscoveryResult) => {
        sharedCacheStore.set(key, value);
      }),
    };

    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = input.toString();

      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: resourceUrl,
          authorization_servers: [
            "https://auth.example.com/issuer-a",
            "https://auth.example.com/issuer-b",
          ],
        });
      }

      if (url === failingAuthorizationServerMetadataUrl) {
        return new Response("no metadata here", {
          status: 404,
          statusText: "Not Found",
        });
      }

      if (url === successfulAuthorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: "https://auth.example.com/issuer-b",
          authorization_endpoint: "https://auth.example.com/issuer-b/authorize",
          token_endpoint: "https://auth.example.com/issuer-b/token",
          code_challenge_methods_supported: ["plain", "S256"],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const discoveryClient = new OAuthMetadataDiscovery({
      fetch: fetchMock,
      cache,
    });
    const firstDiscovery = await discoveryClient.discover(resourceUrl);

    expect(firstDiscovery).toMatchObject({
      resource: resourceUrl,
      resourceMetadataUrl,
      authorizationServerMetadataUrl: successfulAuthorizationServerMetadataUrl,
      resourceMetadata: {
        authorization_servers: [
          "https://auth.example.com/issuer-a",
          "https://auth.example.com/issuer-b",
        ],
      },
      authorizationServerMetadata: {
        issuer: "https://auth.example.com/issuer-b",
      },
    });
    expect(fetchMock.mock.calls.map(([input]) => input.toString())).toEqual([
      resourceMetadataUrl,
      failingAuthorizationServerMetadataUrl,
      successfulAuthorizationServerMetadataUrl,
    ]);
    expect(cache.set).toHaveBeenCalledWith(resourceUrl, firstDiscovery);

    const secondDiscovery = await discoveryClient.discover(resourceUrl);

    expect(secondDiscovery).toEqual(firstDiscovery);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cache.get).toHaveBeenCalledWith(resourceUrl);

    const secondFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("Expected cached discovery result");
    });
    const secondDiscoveryClient = new OAuthMetadataDiscovery({
      fetch: secondFetch,
      cache,
    });
    const cachedDiscovery = await secondDiscoveryClient.discover(resourceUrl);

    expect(cachedDiscovery).toEqual(firstDiscovery);
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it("rejects invalid protected resource metadata with a clear error", async () => {
    const resourceUrl = "https://resource.example.com/tenant/mcp";

    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        resource: resourceUrl,
      })
    );

    await expect(discoverOAuthMetadata(resourceUrl, { fetch: fetchMock })).rejects.toThrow(
      "Protected resource metadata must include a non-empty authorization_servers array"
    );
  });

  it("rejects authorization server metadata without S256 support with a clear error", async () => {
    const resourceUrl = "https://resource.example.com/tenant/mcp";

    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = input.toString();

      if (url.includes("oauth-protected-resource")) {
        return jsonResponse({
          resource: resourceUrl,
          authorization_servers: ["https://auth.example.com/issuer-a"],
        });
      }

      return jsonResponse({
        issuer: "https://auth.example.com/issuer-a",
        authorization_endpoint: "https://auth.example.com/issuer-a/authorize",
        token_endpoint: "https://auth.example.com/issuer-a/token",
        code_challenge_methods_supported: ["plain"],
      });
    });

    await expect(discoverOAuthMetadata(resourceUrl, { fetch: fetchMock })).rejects.toThrow(
      "code_challenge_methods_supported containing S256"
    );
  });

  it("normalizes a trailing slash on the authorization server issuer before RFC 8414 lookup", async () => {
    const resourceUrl = "https://resource.example.com/tenant/mcp";
    const normalizedAuthorizationServer = "https://auth.example.com/issuer-a";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";

    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = input.toString();

      if (url.includes("oauth-protected-resource")) {
        return jsonResponse({
          resource: resourceUrl,
          authorization_servers: [`${normalizedAuthorizationServer}/`],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: normalizedAuthorizationServer,
          authorization_endpoint: `${normalizedAuthorizationServer}/authorize`,
          token_endpoint: `${normalizedAuthorizationServer}/token`,
          code_challenge_methods_supported: ["S256"],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const discovery = await discoverOAuthMetadata(resourceUrl, { fetch: fetchMock });

    expect(discovery.authorizationServer).toBe(normalizedAuthorizationServer);
    expect(discovery.authorizationServerMetadataUrl).toBe(authorizationServerMetadataUrl);
    expect(fetchMock.mock.calls.map(([input]) => input.toString())).toEqual([
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp",
      authorizationServerMetadataUrl,
    ]);
  });
});

describe("HttpTransport OAuth authorization", () => {
  it("discovers, registers, authorizes, retries once, and reuses the cached token on the next request", async () => {
    const requestUrl = "https://resource.example.com/tenant/mcp";
    const resourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
    const authorizationServer = "https://auth.example.com/issuer-a";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";
    const authorizationEndpoint = "https://auth.example.com/issuer-a/authorize";
    const tokenEndpoint = "https://auth.example.com/issuer-a/token";
    const registrationEndpoint = "https://auth.example.com/issuer-a/register";

    const resourceAuthorizations: Array<string | null> = [];
    const authorizationRequests: URL[] = [];
    const registrationBodies: Array<Record<string, unknown>> = [];
    const tokenBodies: URLSearchParams[] = [];
    const registeredClientIds = new Set<string>();
    const storedSessions = new Map<string, StoredOAuthSession>();
    const authorizationCodes = new Map<
      string,
      { clientId: string; redirectUri: string; codeChallenge: string }
    >();
    const issuedAccessTokens = new Set<string>();
    let nextClientId = 0;
    let nextAuthorizationCode = 0;
    let nextAccessToken = 0;

    const issueAccessToken = (): string => {
      nextAccessToken += 1;
      const accessToken = `access-${nextAccessToken}`;
      issuedAccessTokens.add(accessToken);
      return accessToken;
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const url = input.toString();

      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: requestUrl,
          authorization_servers: [authorizationServer],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: authorizationServer,
          authorization_endpoint: authorizationEndpoint,
          token_endpoint: tokenEndpoint,
          registration_endpoint: registrationEndpoint,
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (url === registrationEndpoint) {
        nextClientId += 1;
        const clientId = `client-${nextClientId}`;
        registeredClientIds.add(clientId);
        registrationBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

        return jsonResponse(
          {
            client_id: clientId,
            token_endpoint_auth_method: "none",
          },
          { status: 201 }
        );
      }

      if (url === tokenEndpoint) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        tokenBodies.push(body);

        const code = body.get("code");
        if (code === null) {
          throw new Error("Missing authorization code");
        }

        const authorizationCode = authorizationCodes.get(code);
        if (authorizationCode === undefined) {
          throw new Error(`Unknown authorization code: ${code}`);
        }

        authorizationCodes.delete(code);
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe(authorizationCode.clientId);
        expect(body.get("redirect_uri")).toBe(authorizationCode.redirectUri);
        expect(body.get("resource")).toBe(requestUrl);

        return jsonResponse({
          access_token: issueAccessToken(),
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-1",
        });
      }

      if (url === requestUrl && method === "POST") {
        const authorization = new Headers(init?.headers).get("Authorization");
        resourceAuthorizations.push(authorization);

        if (authorization === null) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate":
                `Bearer realm="Example, Inc", error="invalid_token", ` +
                `resource_metadata="${resourceMetadataUrl}"`,
            },
          });
        }

        const accessToken = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : authorization;
        if (!issuedAccessTokens.has(accessToken)) {
          throw new Error(`Unexpected bearer token: ${authorization}`);
        }

        return jsonResponse({
          jsonrpc: "2.0",
          id: resourceAuthorizations.length,
          result: {
            ok: true,
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${method} ${url}`);
    });

    const openBrowser = vi.fn(async (authorizationUrl: string) => {
      const url = new URL(authorizationUrl);
      authorizationRequests.push(url);

      const clientId = url.searchParams.get("client_id");
      if (clientId === null || !registeredClientIds.has(clientId)) {
        throw new Error(`Unknown client ID: ${clientId}`);
      }

      nextAuthorizationCode += 1;
      const code = `code-${nextAuthorizationCode}`;
      authorizationCodes.set(code, {
        clientId,
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
        codeChallenge: url.searchParams.get("code_challenge") ?? "",
      });

      expect(url.searchParams.get("resource")).toBe(requestUrl);

      await requestLoopbackCallback(`${url.searchParams.get("redirect_uri")}?code=${code}`);
    });

    const sessionStore: OAuthSessionStore = {
      async load(resource: string): Promise<StoredOAuthSession | null> {
        return storedSessions.get(resource) ?? null;
      },
      async save(resource: string, session: StoredOAuthSession): Promise<void> {
        storedSessions.set(resource, session);
      },
      async clear(resource: string): Promise<void> {
        storedSessions.delete(resource);
      },
    };

    const transport = new HttpTransport({
      url: requestUrl,
      fetch: fetchMock,
      oauth: {
        client: {
          mode: "dynamic",
          metadata: {
            clientName: "tiny-mcp-client test",
          },
        },
        browser: {
          openBrowser,
        },
        sessionStore,
      },
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(JSON.parse(await readTransportLine(transport))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        ok: true,
      },
    });

    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    expect(JSON.parse(await readTransportLine(transport))).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        ok: true,
      },
    });

    expect(registrationBodies).toHaveLength(1);
    expect(tokenBodies).toHaveLength(1);
    expect(resourceAuthorizations).toEqual([null, "Bearer access-1", "Bearer access-1"]);
    expect(authorizationRequests).toHaveLength(1);
    expect(
      fetchMock.mock.calls
        .map(([input]) => input.toString())
        .filter((url) => url === resourceMetadataUrl)
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls
        .map(([input]) => input.toString())
        .filter((url) => url === authorizationServerMetadataUrl)
    ).toHaveLength(1);
  });

  it("falls back to the derived protected-resource metadata URL when the 401 challenge omits resource_metadata", async () => {
    const requestUrl = "https://resource.example.com/tenant/mcp";
    const resourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
    const authorizationServer = "https://auth.example.com/issuer-a";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";
    const authorizationEndpoint = "https://auth.example.com/issuer-a/authorize";
    const tokenEndpoint = "https://auth.example.com/issuer-a/token";
    const registrationEndpoint = "https://auth.example.com/issuer-a/register";
    const resourceAuthorizations: Array<string | null> = [];
    const authorizationCodes = new Map<
      string,
      { clientId: string; redirectUri: string; codeChallenge: string }
    >();
    const storedSessions = new Map<string, StoredOAuthSession>();
    let nextAuthorizationCode = 0;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const url = input.toString();

      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: requestUrl,
          authorization_servers: [authorizationServer],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: authorizationServer,
          authorization_endpoint: authorizationEndpoint,
          token_endpoint: tokenEndpoint,
          registration_endpoint: registrationEndpoint,
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (url === registrationEndpoint) {
        return jsonResponse(
          {
            client_id: "client-1",
            token_endpoint_auth_method: "none",
          },
          { status: 201 }
        );
      }

      if (url === tokenEndpoint) {
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
        expect(body.get("resource")).toBe(requestUrl);

        return jsonResponse({
          access_token: "access-1",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-1",
        });
      }

      if (url === requestUrl && method === "POST") {
        const authorization = new Headers(init?.headers).get("Authorization");
        resourceAuthorizations.push(authorization);

        if (authorization === null) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": 'Bearer realm="Example, Inc", error="invalid_token"',
            },
          });
        }

        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            ok: true,
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${method} ${url}`);
    });
    const openBrowser = vi.fn(async (authorizationUrl: string) => {
      const url = new URL(authorizationUrl);
      nextAuthorizationCode += 1;

      const code = `code-${nextAuthorizationCode}`;
      authorizationCodes.set(code, {
        clientId: url.searchParams.get("client_id") ?? "",
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
        codeChallenge: url.searchParams.get("code_challenge") ?? "",
      });

      await requestLoopbackCallback(`${url.searchParams.get("redirect_uri")}?code=${code}`);
    });

    const sessionStore: OAuthSessionStore = {
      async load(resource: string): Promise<StoredOAuthSession | null> {
        return storedSessions.get(resource) ?? null;
      },
      async save(resource: string, session: StoredOAuthSession): Promise<void> {
        storedSessions.set(resource, session);
      },
      async clear(resource: string): Promise<void> {
        storedSessions.delete(resource);
      },
    };

    const transport = new HttpTransport({
      url: requestUrl,
      fetch: fetchMock,
      oauth: {
        client: {
          mode: "dynamic",
          metadata: {
            clientName: "tiny-mcp-client test",
          },
        },
        browser: {
          openBrowser,
        },
        sessionStore,
      },
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(JSON.parse(await readTransportLine(transport))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        ok: true,
      },
    });

    expect(resourceAuthorizations).toEqual([null, "Bearer access-1"]);
    expect(
      fetchMock.mock.calls
        .map(([input]) => input.toString())
        .filter((url) => url === resourceMetadataUrl)
    ).toHaveLength(1);
  });
});

function readTransportLine(transport: HttpTransport): Promise<string> {
  return new Promise((resolve, reject) => {
    transport.readable.once("data", (chunk: Buffer | string) => {
      resolve(chunk.toString("utf8").trim());
    });
    transport.closed.then((event) => {
      reject(event.reason);
    }).catch(reject);
  });
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
