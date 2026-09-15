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
