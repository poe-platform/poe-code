import { expect, it, vi } from "vitest";
import { exchangeAuthorizationCode, refreshAccessToken } from "./token-endpoint.js";

const methods = [exchangeAuthorizationCode, refreshAccessToken] as const;
it.each(methods)("form-encodes Basic credentials without duplicating body secrets: %s", async run => {
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ access_token: "access", token_type: "Bearer" }));
  await run({ tokenEndpoint: "https://auth.example/token", clientId: "client: a+🐈", clientSecret: "secret: b+🐈",
    tokenEndpointAuthMethod: "client_secret_basic", code: "code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1/callback",
    refreshToken: "refresh", resource: "https://resource.example/mcp", fetch, now: () => 1000 } as Parameters<typeof run>[0]);
  const init = fetch.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${Buffer.from("client%3A+a%2B%F0%9F%90%88:secret%3A+b%2B%F0%9F%90%88").toString("base64")}`);
  const body = new URLSearchParams(String(init?.body));
  expect(body.has("client_secret")).toBe(false);
  expect(body.has("client_id")).toBe(false);
  expect(body.get("resource")).toBe("https://resource.example/mcp");
});

it.each(methods)("does not send an available secret for an explicitly public client: %s", async run => {
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ access_token: "access", token_type: "Bearer" }));
  await run({ tokenEndpoint: "https://auth.example/token", clientId: "client", clientSecret: "private-secret",
    tokenEndpointAuthMethod: "none", code: "code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1/callback",
    refreshToken: "refresh", resource: "https://resource.example/mcp", fetch, now: () => 1000 } as Parameters<typeof run>[0]);
  const init = fetch.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  expect(new URLSearchParams(String(init?.body)).has("client_secret")).toBe(false);
  expect(new URLSearchParams(String(init?.body)).get("client_id")).toBe("client");
});

it.each(["client_secret_basic", "client_secret_post", "private_key_jwt"])("rejects unsupported or incomplete authentication before calling fetch: %s", async method => {
  const fetch = vi.fn(async () => Response.json({}));
  await expect(refreshAccessToken({ tokenEndpoint: "https://auth.example/token", clientId: "client", tokenEndpointAuthMethod: method,
    refreshToken: "refresh", resource: "https://resource.example/mcp", fetch, now: () => 1000 } as Parameters<typeof refreshAccessToken>[0])).rejects.toThrow("OAuth token endpoint authentication");
  expect(fetch).not.toHaveBeenCalled();
});
