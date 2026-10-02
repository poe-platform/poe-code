import { describe, expect, it, vi } from "vitest";
import * as api from "../index.browser.js";

const endpoint = "https://auth.example/revoke";
const common = { revocationEndpoint: endpoint, clientId: "client :+", token: "private-token" };

describe("revokeOAuthToken", () => {
  it.each(["none", "client_secret_post", "client_secret_basic"] as const)("uses %s authentication and accepts an empty success", async method => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(_url).toBe(endpoint);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const body = new URLSearchParams(String(init?.body));
      const headers = new Headers(init?.headers);
      expect(body.get("token")).toBe("private-token");
      expect(body.get("token_type_hint")).toBe("refresh_token");
      if (method === "client_secret_basic") {
        expect(headers.get("Authorization")).toBe(`Basic ${btoa("client+%3A%2B:secret+%3A%2B")}`);
        expect(body.has("client_id")).toBe(false);
        expect(body.has("client_secret")).toBe(false);
      } else {
        expect(headers.has("Authorization")).toBe(false);
        expect(body.get("client_id")).toBe("client :+");
        expect(body.get("client_secret")).toBe(method === "client_secret_post" ? "secret :+" : null);
      }
      return new Response("");
    });
    await expect(api.revokeOAuthToken({ ...common, tokenTypeHint: "refresh_token", clientSecret: "secret :+", tokenEndpointAuthMethod: method, fetch })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not require JSON in a successful revocation response", async () => {
    await expect(api.revokeOAuthToken({ ...common, fetch: async () => new Response("already revoked") })).resolves.toBeUndefined();
  });

  it("preserves the OAuth error and never retries an unsuccessful revocation", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "unsupported_token_type" }), { status: 400 }));
    await expect(api.revokeOAuthToken({ ...common, fetch })).rejects.toMatchObject({ error: "unsupported_token_type", status: 400, outcomeKnown: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([302, 503])("rejects HTTP %s without a valid OAuth error", async status => {
    await expect(api.revokeOAuthToken({ ...common, fetch: async () => new Response("", { status }) })).rejects.toMatchObject({ status, outcomeKnown: false });
  });

  it("rejects missing confidential credentials before dispatch", async () => {
    const fetch = vi.fn();
    await expect(api.revokeOAuthToken({ ...common, tokenEndpointAuthMethod: "client_secret_basic", fetch })).rejects.toThrow("client secret");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty token before dispatch", async () => {
    const fetch = vi.fn();
    await expect(api.revokeOAuthToken({ ...common, token: "", fetch })).rejects.toThrow("token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not dispatch an aborted operation", async () => {
    const fetch = vi.fn();
    const reason = new Error("cancelled");
    await expect(api.revokeOAuthToken({ ...common, signal: AbortSignal.abort(reason), fetch })).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("settles cancellation even if the supplied transport ignores its signal", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const fetch = vi.fn(async () => { controller.abort(reason); return new Promise<Response>(() => {}); });
    await expect(api.revokeOAuthToken({ ...common, signal: controller.signal, fetch })).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds successful response bodies", async () => {
    await expect(api.revokeOAuthToken({ ...common, fetch: async () => new Response("x".repeat(1024 * 1024 + 1)) })).rejects.toThrow("exceeds");
  });
});
