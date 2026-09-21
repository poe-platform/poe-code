import { describe, expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

const resource = "https://resource.example.com/mcp";
const oldIssuer = "https://old-auth.example.com";
const newIssuer = "https://new-auth.example.com";

vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
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


it.each(["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const)(
  "rejects an empty %s fragment before consent or persistence", async field => {
    const metadata = discovery("https://auth.example");
    metadata.authorizationServerMetadata[field] = `https://auth.example/${field}#`;
    const fetch = vi.fn(async () => Response.json({ access_token: "private-access", token_type: "Bearer" }));
    const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
    const save = vi.fn(async () => {}), clear = vi.fn(async () => {});
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" },
      browser: { openBrowser }, sessionStore: { load: async () => null, save, clear } });
    expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
      challenge: null, discovery: metadata, fetch }))
      .toMatchObject({ action: "fail", error: { message: expect.stringContaining("credentials or fragment") } });
    expect(openBrowser).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  }
);

it.each(["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const)(
  "rejects a stored empty %s fragment before pending refresh writes", async field => {
    const metadata = discovery("https://auth.example");
    metadata.authorizationServerMetadata[field] = `https://auth.example/${field}#`;
    const session: StoredOAuthSession = { resource, authorizationServer: metadata.authorizationServer, client: { clientId: "client" },
      tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: 0 },
      discovery: { resourceMetadataUrl: metadata.resourceMetadataUrl, resourceMetadata: metadata.resourceMetadata,
        authorizationServerMetadata: metadata.authorizationServerMetadata } };
    const fetch = vi.fn(async () => Response.json({ access_token: "fresh", token_type: "Bearer" }));
    const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
    const save = vi.fn(async () => {}), clear = vi.fn(async () => {});
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, allowInteractive: false,
      browser: { openBrowser }, now: () => 1000, sessionStore: { load: async () => session, save, clear } });
    await expect(provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch }))
      .rejects.toThrow("credentials or fragment");
    expect(openBrowser).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  }
);

it.each(["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const)(
  "retains percent-escaped hashes in direct %s metadata", async field => {
    const metadata = discovery("https://auth.example");
    metadata.authorizationServerMetadata[field] = "https://auth.example/path%23data?literal=%23";
    const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
    const fetch = vi.fn(async () => { throw new Error("unexpected credential request"); });
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { openBrowser },
      sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
    expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
      challenge: null, discovery: metadata, fetch })).toMatchObject({ action: "fail", error: { message: "browser reached" } });
    expect(openBrowser).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  }
);


it.each(["?", "?private=marker"])("rejects a direct discovery issuer query before authorization: %s", query => {
  const metadata = discovery("https://auth.example" + query);
  Object.assign(metadata.authorizationServerMetadata, { authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token" });
  const openBrowser = vi.fn(async () => { throw new Error("browser reached"); }), save = vi.fn(async () => {});
  const fetch = vi.fn(async () => Response.json({ access_token: "private-access", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { openBrowser },
    sessionStore: { load: async () => null, save, clear: async () => {} } });
  return provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null,
    discovery: metadata, fetch }).then(result => {
    expect(result).toMatchObject({ action: "fail", error: { message: "Authorization server issuer must not include query or fragment" } });
    expect(openBrowser).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

it.each(["?", "?private=marker"])("rejects a stored issuer query before token redemption: %s", async query => {
  const metadata = discovery("https://auth.example" + query);
  Object.assign(metadata.authorizationServerMetadata, { authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token" });
  const session: StoredOAuthSession = { resource, authorizationServer: metadata.authorizationServer, client: { clientId: "client" },
    tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: metadata.resourceMetadataUrl, resourceMetadata: metadata.resourceMetadata,
      authorizationServerMetadata: metadata.authorizationServerMetadata } };
  const save = vi.fn(async () => {}), fetch = vi.fn(async () => Response.json({ access_token: "fresh", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, now: () => 1000,
    allowInteractive: false, sessionStore: { load: async () => session, save, clear: async () => {} } });
  await expect(provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch }))
    .rejects.toThrow(new Error("Authorization server issuer must not include query or fragment"));
  expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});


it("retains escaped query delimiters in direct issuer paths", async () => {
  const metadata = discovery("https://auth.example/path%3Fdata%23data");
  const openBrowser = vi.fn(async () => { throw new Error("browser reached"); });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { openBrowser },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: null, discovery: metadata, fetch: vi.fn() })).toMatchObject({ action: "fail", error: { message: "browser reached" } });
  expect(openBrowser).toHaveBeenCalledOnce();
});


it.each(["?", "?private=marker"])("keeps a valid persisted grant when new discovery has an invalid issuer query: %s", async query => {
  const oldMetadata = discovery(oldIssuer), newMetadata = discovery(newIssuer + query);
  Object.assign(newMetadata.authorizationServerMetadata, { authorization_endpoint: newIssuer + "/authorize", token_endpoint: newIssuer + "/token" });
  const original: StoredOAuthSession = { resource, authorizationServer: oldIssuer, client: { clientId: "client" },
    tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: 100_000 },
    discovery: { resourceMetadataUrl: oldMetadata.resourceMetadataUrl, resourceMetadata: oldMetadata.resourceMetadata,
      authorizationServerMetadata: oldMetadata.authorizationServerMetadata } };
  let session: StoredOAuthSession | null = original;
  const clear = vi.fn(async () => { session = null; }), save = vi.fn(async (_key: string, next: StoredOAuthSession) => { session = next; });
  const fetch = vi.fn(async () => { throw new Error("unexpected network"); }), openBrowser = vi.fn(async () => { throw new Error("unexpected consent"); });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { openBrowser }, now: () => 1000,
    sessionStore: { load: async () => session, save, clear } });
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: null, discovery: newMetadata, fetch })).toMatchObject({ action: "fail", error: { message: "Authorization server issuer must not include query or fragment" } });
  expect(clear).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(openBrowser).not.toHaveBeenCalled();
  expect(session).toBe(original);
});
