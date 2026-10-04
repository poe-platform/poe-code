import { describe, expect, it, vi } from "vitest";
import * as oauth from "../index.js";
import * as browser from "../index.browser.js";
import type { OAuthMetadataFetch } from "./types.js";

const endpoint = "https://auth.example/register";
const redirectUri = "https://app.example/callback";
const registered = { client_id: "client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" };

describe("registerOAuthClient", () => {
  it("shares the registration operation with the Worker entry point", () => {
    expect(browser.registerOAuthClient).toBe(oauth.registerOAuthClient);
  });
  it("registers once through the public API without starting consent or persisting credentials", async () => {
    const fetch = vi.fn<OAuthMetadataFetch>(async () => Response.json(registered));
    expect(await oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri,
      metadata: { clientName: "Poe" }, tokenEndpointAuthMethod: "none", fetch })).toEqual(registered);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(request!.redirect).toBe("error");
    expect(request!.method).toBe("POST");
    expect(JSON.parse(String(request!.body))).toEqual({ client_name: "Poe", redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
  });

  it("transmits every redirect exactly through Node and Worker exports", async () => {
    const redirectUris = [redirectUri, "https://poe.example:443/callback?deployment=1", "http://127.0.0.1:4321/callback"] as const;
    for (const api of [oauth, browser]) {
      const fetch = vi.fn<OAuthMetadataFetch>(async () => Response.json({ ...registered, redirect_uris: redirectUris }));
      const result = await api.registerOAuthClient({ registrationEndpoint: endpoint, redirectUris, fetch });
      expect(result.redirect_uris).toEqual(redirectUris);
      expect(JSON.parse(String(fetch.mock.calls[0][1]!.body)).redirect_uris).toEqual(redirectUris);
    }
  });

  it.each([
    null, [], [redirectUri, redirectUri], [redirectUri, "bad"], [redirectUri, "https://user:pass@app.example/callback"],
    [redirectUri, "https://app.example/callback#"], [redirectUri, "http://external.example/callback"],
    [redirectUri, "http://localhost/callback#fragment"], [redirectUri, "https://app.example/callback?code=secret"],
    [redirectUri, ""], [redirectUri, null], new Array(2), "https://app.example/callback",
    Array.from({ length: 33 }, (_, i) => `https://app.example/callback/${i}`)
  ].map(redirectUris => ({ redirectUris })))("rejects invalid redirect lists before fetch: $redirectUris", async ({ redirectUris }) => {
    const fetch = vi.fn<OAuthMetadataFetch>();
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUris, fetch } as unknown as oauth.RegisterOAuthClientOptions)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects ambiguous or missing redirect input before fetch", async () => {
    const fetch = vi.fn<OAuthMetadataFetch>();
    for (const redirects of [{}, { redirectUri, redirectUris: [redirectUri] }]) {
      await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, ...redirects, fetch } as oauth.RegisterOAuthClientOptions)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the count bound and retains byte bounds and cancellation for lists", async () => {
    const redirectUris = Array.from({ length: 32 }, (_, i) => `https://app.example/callback/${i}`);
    const fetch = vi.fn<OAuthMetadataFetch>(async () => Response.json(registered));
    await oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUris, fetch });
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body)).redirect_uris).toEqual(redirectUris);
    fetch.mockClear();
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUris: [redirectUri + "x".repeat(65_536)], fetch })).rejects.toThrow("too large");
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUris, fetch, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not replay failed registration", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "invalid_client_metadata" }, { status: 400 }));
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri, fetch })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ redirectUri }, { redirectUris: [redirectUri] }])("cancels a host fetch which ignores its signal: %j", async redirects => {
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const result = oauth.registerOAuthClient({ registrationEndpoint: endpoint, ...redirects, fetch, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow();
  });

  it("bounds and validates the provider response", async () => {
    for (const response of [Response.json({ client_id: " " }), new Response("x".repeat(1024 * 1024 + 1))]) {
      await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri,
        fetch: async () => response })).rejects.toThrow();
    }
  });

  it("bounds registration input before network access", async () => {
    const fetch = vi.fn<OAuthMetadataFetch>(async () => Response.json(registered));
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri,
      metadata: { clientName: "x".repeat(65_536) }, fetch })).rejects.toThrow("too large");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid redirect configuration before registering", async () => {
    const fetch = vi.fn<OAuthMetadataFetch>(async () => Response.json(registered));
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri: "https://app.example/callback#secret", fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
