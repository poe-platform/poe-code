import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions } from "./types.js";

const selected = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock("./loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async (options: Record<string, unknown>) => {
    selected.options = options; return { redirectUri: options.redirectUri ?? "http://127.0.0.1:49152/callback", waitForCode: async () => "005930", close() {} };
  } }));

it.each(["signal", "timeoutMs", "redirectUri", "createServer", "openBrowser", "readLine"] as const)(
  "passes native nonenumerable browser %s through the provider", async field => {
    const original = field === "signal" ? new AbortController().signal : field === "timeoutMs" ? 17
      : field === "redirectUri" ? "http://127.0.0.1:39119/original?app=one" : vi.fn(function(this: unknown) { return this; });
    const browser = Object.defineProperty({}, field, { value: original }) as DefaultOAuthClientProviderOptions["browser"];
    const resource = "https://resource.example/mcp", issuer = "https://auth.example";
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original" }, browser,
      sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
    selected.options = undefined;
    expect(await provider.authenticate!({ requestUrl: new URL(resource), fetch: async () => Response.json({ access_token: "original", token_type: "Bearer" }),
      discover: async () => ({ resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
        authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: { issuer,
          authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } }) })).toMatchObject({ accessToken: "original" });
    if (typeof original === "function") {
      const callback = selected.options?.[field] as () => unknown;
      expect(callback()).toBe(browser); expect(original).toHaveBeenCalledOnce();
    } else expect(selected.options?.[field]).toBe(original);
  }
);
