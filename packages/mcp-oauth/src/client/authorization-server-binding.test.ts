import { describe, expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

const resource = "https://resource.example.com/mcp";
const oldIssuer = "https://old-auth.example.com";
const newIssuer = "https://new-auth.example.com";

vi.mock("./loopback-authorization.js", () => ({
  createLoopbackAuthorizationSession: async (options: { openBrowser(url: string): Promise<void> }) => ({
    redirectUri: "http://127.0.0.1:12345/callback",
    waitForCode: async (url: string) => {
      await options.openBrowser(url);
      return "authorization-code";
    },
    close: vi.fn()
  })
}));

function discovery(issuer: string): OAuthDiscoveryResult {
  return {
    resource,
    resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
    resourceMetadata: { resource, authorization_servers: [issuer] },
    authorizationServer: issuer,
    authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"]
    }
  };
}

describe("OAuth authorization-server credential binding", () => {
  it.each([0, 100_000])(
    "discards old issuer credentials with expiry %s before using new discovery",
    async (expiresAt) => {
      const oldDiscovery = discovery(oldIssuer);
      let stored: StoredOAuthSession | null = {
        resource,
        authorizationServer: oldIssuer,
        client: { clientId: "old-client", clientSecret: "old-secret" },
        tokens: {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          tokenType: "Bearer",
          expiresAt
        },
        discovery: {
          resourceMetadataUrl: oldDiscovery.resourceMetadataUrl,
          resourceMetadata: oldDiscovery.resourceMetadata,
          authorizationServerMetadata: oldDiscovery.authorizationServerMetadata
        }
      };
      const clear = vi.fn(async () => {
        stored = null;
      });
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "attacker-access",
              token_type: "Bearer",
              expires_in: 3600
            })
          )
      );
      const openBrowser = vi.fn(async () => {
        throw new Error("Interactive consent required");
      });
      const provider = createDefaultOAuthClientProvider({
        client: { mode: "static", clientId: "new-client" },
        browser: { openBrowser },
        now: () => 1000,
        sessionStore: {
          load: async () => stored,
          save: async (_resource, session) => {
            stored = session;
          },
          clear
        }
      });

      const result = await provider.handleUnauthorized({
        requestUrl: new URL(resource),
        response: new Response(null, { status: 401 }),
        challenge: null,
        discovery: discovery(newIssuer),
        fetch
      });

      expect(result).toMatchObject({
        action: "fail",
        error: { message: "Interactive consent required" }
      });
      expect(clear).toHaveBeenCalledWith(resource);
      expect(fetch).not.toHaveBeenCalled();
      expect(openBrowser).toHaveBeenCalledOnce();
    }
  );
});

it.each(["http://127.attacker.example", "http://127.0.0.1.attacker.example"])(
  "rejects OAuth flow endpoints on HTTP DNS hosts resembling loopback: %s", async (issuer) => {
    const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" }, browser: { openBrowser },
      sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
    });
    const result = await provider.handleUnauthorized({ requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }), challenge: null,
      discovery: discovery(issuer), fetch: vi.fn() });
    expect(result).toMatchObject({ action: "fail", error: { message: expect.stringContaining("https") } });
    expect(openBrowser).not.toHaveBeenCalled();
  }
);

it("allows IPv6 loopback OAuth flow endpoints", async () => {
  const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
  const provider = createDefaultOAuthClientProvider({
    client: { mode: "static", clientId: "client" }, browser: { openBrowser },
      sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
  });
  const result = await provider.handleUnauthorized({ requestUrl: new URL(resource),
    response: new Response(null, { status: 401 }), challenge: null,
    discovery: discovery("http://[::1]"), fetch: vi.fn() });
  expect(result).toMatchObject({ action: "fail", error: { message: "browser reached" } });
  expect(openBrowser).toHaveBeenCalledOnce();
});

it.each(["https://user:secret@auth.example", "https://auth.example/authorize#fragment"])(
  "rejects credentials or fragments in OAuth authorization endpoints: %s", async (endpoint) => {
    const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" },
      browser: { openBrowser }, sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
    const metadata = discovery("https://auth.example");
    metadata.authorizationServerMetadata.authorization_endpoint = endpoint;
    const result = await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
      challenge: null, discovery: metadata, fetch: vi.fn() });
    expect(result).toMatchObject({ action: "fail", error: { message: expect.stringContaining("credentials or fragment") } });
    expect(openBrowser).not.toHaveBeenCalled();
  }
);
