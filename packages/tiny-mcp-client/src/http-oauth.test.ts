import { describe, expect, it, vi } from "vitest";
import {
  HttpTransport,
  type OAuthClientProvider,
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

describe("HttpTransport OAuth discovery", () => {
  it("parses quoted bearer challenge parameters and hands discovered metadata to the provider", async () => {
    const requestUrl = "https://resource.example.com/tenant/mcp";
    const resourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";

    const handleUnauthorized = vi.fn(async (input) => {
      expect(input.challenge).toMatchObject({
        scheme: "Bearer",
        params: {
          realm: "Example, Inc",
          error: "invalid_token",
          resource_metadata: resourceMetadataUrl,
        },
      });
      expect(input.discovery).toMatchObject({
        resource: requestUrl,
        resourceMetadataUrl,
        authorizationServerMetadataUrl,
      });

      throw new Error("oauth discovery triggered");
    });

    const oauth: OAuthClientProvider = {
      authorizeRequest: vi.fn(async () => {}),
      handleUnauthorized,
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const url = input.toString();

      if (method === "POST") {
        return new Response(null, {
          status: 401,
          statusText: "Unauthorized",
          headers: {
            "WWW-Authenticate":
              `Bearer realm="Example, Inc", error="invalid_token", ` +
              `resource_metadata="${resourceMetadataUrl}"`,
          },
        });
      }

      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: requestUrl,
          authorization_servers: ["https://auth.example.com/issuer-a"],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: "https://auth.example.com/issuer-a",
          authorization_endpoint: "https://auth.example.com/issuer-a/authorize",
          token_endpoint: "https://auth.example.com/issuer-a/token",
          code_challenge_methods_supported: ["S256"],
        });
      }

      throw new Error(`Unexpected fetch URL: ${method} ${url}`);
    });

    const transport = new HttpTransport({
      url: requestUrl,
      fetch: fetchMock,
      oauth,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;

    expect(handleUnauthorized).toHaveBeenCalledTimes(1);
    expect(closedEvent.reason.message).toBe("oauth discovery triggered");
  });

  it("falls back to the path-based protected resource metadata URL when the challenge omits a hint", async () => {
    const requestUrl = "https://resource.example.com/tenant/mcp?view=full";
    const fallbackResourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp?view=full";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";

    const handleUnauthorized = vi.fn(async (input) => {
      expect(input.challenge).toMatchObject({
        scheme: "Bearer",
        params: {
          realm: "Example Realm",
          error: "invalid_token",
        },
      });
      expect(input.discovery.resourceMetadataUrl).toBe(fallbackResourceMetadataUrl);

      throw new Error("oauth fallback triggered");
    });

    const oauth: OAuthClientProvider = {
      authorizeRequest: vi.fn(async () => {}),
      handleUnauthorized,
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const url = input.toString();

      if (method === "POST") {
        return new Response(null, {
          status: 401,
          statusText: "Unauthorized",
          headers: {
            "WWW-Authenticate": 'Bearer realm="Example Realm", error="invalid_token"',
          },
        });
      }

      if (url === fallbackResourceMetadataUrl) {
        return jsonResponse({
          resource: requestUrl,
          authorization_servers: ["https://auth.example.com/issuer-a"],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: "https://auth.example.com/issuer-a",
          authorization_endpoint: "https://auth.example.com/issuer-a/authorize",
          token_endpoint: "https://auth.example.com/issuer-a/token",
          code_challenge_methods_supported: ["S256"],
        });
      }

      throw new Error(`Unexpected fetch URL: ${method} ${url}`);
    });

    const transport = new HttpTransport({
      url: requestUrl,
      fetch: fetchMock,
      oauth,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;

    expect(handleUnauthorized).toHaveBeenCalledTimes(1);
    expect(closedEvent.reason.message).toBe("oauth fallback triggered");
    expect(fetchMock.mock.calls.map(([input]) => input.toString())).toEqual([
      requestUrl,
      fallbackResourceMetadataUrl,
      authorizationServerMetadataUrl,
    ]);
  });

  it("triggers discovery from the SSE GET path after a 401 challenge", async () => {
    const requestUrl = "https://resource.example.com/tenant/mcp";
    const resourceMetadataUrl =
      "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
    const authorizationServerMetadataUrl =
      "https://auth.example.com/.well-known/oauth-authorization-server/issuer-a";

    const handleUnauthorized = vi.fn(async (input) => {
      expect(input.challenge).toMatchObject({
        scheme: "Bearer",
        params: {
          error: "invalid_token",
          resource_metadata: resourceMetadataUrl,
        },
      });
      expect(input.discovery).toMatchObject({
        resource: requestUrl,
        resourceMetadataUrl,
        authorizationServerMetadataUrl,
      });

      throw new Error("oauth get discovery triggered");
    });

    const oauth: OAuthClientProvider = {
      authorizeRequest: vi.fn(async () => {}),
      handleUnauthorized,
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const url = input.toString();

      if (method === "POST") {
        return new Response(null, {
          status: 202,
          headers: {
            "Mcp-Session-Id": "session-1",
          },
        });
      }

      if (method === "GET" && url === requestUrl) {
        return new Response(null, {
          status: 401,
          statusText: "Unauthorized",
          headers: {
            "WWW-Authenticate":
              `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`,
          },
        });
      }

      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: requestUrl,
          authorization_servers: ["https://auth.example.com/issuer-a"],
        });
      }

      if (url === authorizationServerMetadataUrl) {
        return jsonResponse({
          issuer: "https://auth.example.com/issuer-a",
          authorization_endpoint: "https://auth.example.com/issuer-a/authorize",
          token_endpoint: "https://auth.example.com/issuer-a/token",
          code_challenge_methods_supported: ["S256"],
        });
      }

      throw new Error(`Unexpected fetch URL: ${method} ${url}`);
    });

    const transport = new HttpTransport({
      url: requestUrl,
      fetch: fetchMock,
      oauth,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;

    expect(handleUnauthorized).toHaveBeenCalledTimes(1);
    expect(closedEvent.reason.message).toBe("oauth get discovery triggered");
    expect(fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${input.toString()}`))
      .toEqual([
        `POST ${requestUrl}`,
        `GET ${requestUrl}`,
        `GET ${resourceMetadataUrl}`,
        `GET ${authorizationServerMetadataUrl}`,
      ]);
  });
});
