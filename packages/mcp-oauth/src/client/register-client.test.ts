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

  it("does not replay failed registration", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "invalid_client_metadata" }, { status: 400 }));
    await expect(oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri, fetch })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a host fetch which ignores its signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const result = oauth.registerOAuthClient({ registrationEndpoint: endpoint, redirectUri, fetch, signal: controller.signal });
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
