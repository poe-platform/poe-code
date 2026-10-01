import { expect, it, vi } from "vitest";
import * as api from "../index.browser.js";

it("exposes resumable OAuth in the Worker entrypoint", () => {
  expect(api).toHaveProperty("beginRemoteMcpAuthorization", expect.any(Function));
  expect(api).toHaveProperty("completeRemoteMcpAuthorization", expect.any(Function));
});

import type { RemoteMcpAuthorizationTransaction, RemoteMcpAuthorizationStore } from "./resumable.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";
const resource = "https://mcp.example/mcp", issuer = "https://auth.example";
const redirectUri = "https://app.example/callback?app=one";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`,
  resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServer: issuer,
  authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: { issuer,
    authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true } };
function fixture() {
  const records = new Map<string, string>();
  let saved: StoredOAuthSession | undefined;
  let current = true;
  let time = 1000;
  const store: RemoteMcpAuthorizationStore = {
    async create(transaction) { records.set(transaction.state, JSON.stringify(transaction)); },
    async consume(state) { const value = records.get(state); records.delete(state); return value === undefined ? null : JSON.parse(value); },
    async commit(_transaction, session) { if (!current) return false; saved = session; current = false; return true; }
  };
  const fetch = vi.fn(async () => Response.json({ access_token: "private-token", refresh_token: "private-refresh", token_type: "Bearer", expires_in: 60 }));
  const options = { resource, redirectUri, client: { clientId: "client", clientSecret: "private-secret", tokenEndpointAuthMethod: "client_secret_basic" as const },
    store, discover: vi.fn(async () => discovery), now: () => time, scope: "read" };
  async function begin() {
    const result = await api.beginRemoteMcpAuthorization(options);
    const auth = new URL(result.authorizationUrl);
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", auth.searchParams.get("state")!);
    callback.searchParams.set("code", "private-code"); callback.searchParams.set("iss", issuer);
    return { result, auth, callback, transaction: JSON.parse([...records.values()][0]) as RemoteMcpAuthorizationTransaction };
  }
  const complete = (callback: URL) => api.completeRemoteMcpAuthorization({ callbackUrl: callback.href, store: { ...store }, fetch, now: () => time });
  return { options, begin, complete, fetch, records, saved: () => saved, reset: () => { current = false; }, advance: () => { time += 600_001; } };
}
it("resumes JSON durable state in a fresh host instance, preserving PKCE, static credentials and redirect", async () => {
  const f = fixture(), { result, auth, callback, transaction } = await f.begin();
  expect(result).not.toHaveProperty("codeVerifier");
  expect(JSON.stringify(result)).not.toContain("private-secret");
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(transaction.codeVerifier)));
  expect(auth.searchParams.get("code_challenge")).toBe(Buffer.from(expected).toString("base64url"));
  expect(await f.complete(callback)).toEqual({ resource });
  expect(f.fetch).toHaveBeenCalledOnce();
  const [endpoint, init] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(endpoint).toBe(`${issuer}/token`); expect(init.redirect).toBe("error");
  const body = new URLSearchParams(String(init.body));
  expect(body.get("code_verifier")).toBe(transaction.codeVerifier);
  expect(body.get("redirect_uri")).toBe(redirectUri); expect(body.get("resource")).toBe(resource);
  expect(new Headers(init.headers).get("Authorization")).toBe(`Basic ${btoa("client:private-secret")}`);
  expect(f.saved()?.tokens).toMatchObject({ accessToken: "private-token", scope: "read", expiresAt: 61000 });
  await expect(f.complete(callback)).rejects.toThrow("Unable to complete MCP authorization");
  expect(f.fetch).toHaveBeenCalledOnce();
});
it("allows only one concurrent callback redemption", async () => {
  const f = fixture(), { callback } = await f.begin();
  const outcomes = await Promise.allSettled([f.complete(callback), f.complete(callback)]);
  expect(outcomes.map(x => x.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(f.fetch).toHaveBeenCalledOnce();
});
it.each(["host", "path", "query", "issuer", "missingIssuer", "duplicateCode", "duplicateState", "error", "fragment", "state", "expired"])("rejects %s callbacks before exchange", async kind => {
  const f = fixture(), { callback } = await f.begin();
  if (kind === "host") callback.hostname = "other.example";
  if (kind === "path") callback.pathname = "/other";
  if (kind === "query") callback.searchParams.set("app", "two");
  if (kind === "issuer") callback.searchParams.set("iss", "https://other.example");
  if (kind === "missingIssuer") callback.searchParams.delete("iss");
  if (kind === "duplicateCode") callback.searchParams.append("code", "other");
  if (kind === "duplicateState") callback.searchParams.append("state", "other");
  if (kind === "error") callback.searchParams.set("error", "private-secret");
  if (kind === "fragment") callback.hash = "private-secret";
  if (kind === "state") callback.searchParams.set("state", "unknown");
  if (kind === "expired") f.advance();
  await expect(f.complete(callback)).rejects.toThrow(/^Unable to complete MCP authorization$/);
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.saved()).toBeUndefined();
});
it("fences persistence when reset races token exchange", async () => {
  const f = fixture(), { callback } = await f.begin();
  f.fetch.mockImplementation(async () => { f.reset(); return Response.json({ access_token: "late", token_type: "Bearer" }); });
  await expect(f.complete(callback)).rejects.toThrow("Unable to complete MCP authorization");
  expect(f.saved()).toBeUndefined();
});
it("redacts endpoint errors and consumes failed exchanges permanently", async () => {
  const f = fixture(), { callback } = await f.begin();
  f.fetch.mockImplementation(async () => { throw new Error("private-code private-secret private-token"); });
  await expect(f.complete(callback)).rejects.toThrow(/^Unable to complete MCP authorization$/);
  await expect(f.complete(callback)).rejects.toThrow(); expect(f.fetch).toHaveBeenCalledOnce();
});
it("rejects token redirects and cancellation without persisting", async () => {
  const f = fixture(), { callback } = await f.begin();
  f.fetch.mockImplementation(async () => { const response = Response.json({ access_token: "private-token", token_type: "Bearer" }); Object.defineProperty(response, "redirected", { value: true }); return response; });
  await expect(f.complete(callback)).rejects.toThrow(); expect(f.saved()).toBeUndefined();
  const controller = new AbortController(); controller.abort(new Error("private-reason"));
  await expect(api.beginRemoteMcpAuthorization({ ...f.options, signal: controller.signal })).rejects.toThrow(/^Unable to begin MCP authorization$/);
});
it.each(["http://app.example/cb", "https://user@app.example/cb", "https://app.example/cb#", "https://app.example/cb?state=bad"])("rejects invalid redirect %s before discovery", async redirectUri => {
  const f = fixture();
  await expect(api.beginRemoteMcpAuthorization({ ...f.options, redirectUri })).rejects.toThrow();
  expect(f.options.discover).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});
it("rejects mismatched discovery without persisting", async () => {
  const f = fixture(); f.options.discover.mockResolvedValue({ ...discovery, resource: "https://other.example" });
  await expect(f.begin()).rejects.toThrow(); expect(f.records.size).toBe(0);
});
it.each(["unsupported", "missing-secret", "registration-mismatch"])("rejects invalid static client %s before discovery", async kind => {
  const f = fixture();
  const client = kind === "unsupported" ? { clientId: "client", tokenEndpointAuthMethod: "bad" } : kind === "missing-secret"
    ? { clientId: "client", tokenEndpointAuthMethod: "client_secret_basic" }
    : { clientId: "client", registration: { client_id: "different" } };
  await expect(api.beginRemoteMcpAuthorization({ ...f.options, client: client as never })).rejects.toThrow();
  expect(f.options.discover).not.toHaveBeenCalled();
});

it("imports and executes the Worker bundle without Buffer, filesystem or listener APIs", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const bundle = await build({ entryPoints: ["packages/mcp-oauth/src/index.browser.ts"], bundle: true, platform: "neutral",
    format: "cjs", write: false, metafile: true });
  expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.includes("auth-store") || path.includes("loopback"))).toBe(false);
  const module = { exports: {} as typeof api };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, crypto, btoa, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, Headers, Response, AbortSignal, structuredClone, setTimeout, clearTimeout });
  const f = fixture();
  const result = await module.exports.beginRemoteMcpAuthorization(f.options);
  const auth = new URL(result.authorizationUrl), callback = new URL(redirectUri);
  callback.searchParams.set("state", auth.searchParams.get("state")!); callback.searchParams.set("code", "code"); callback.searchParams.set("iss", issuer);
  expect(await module.exports.completeRemoteMcpAuthorization({ callbackUrl: callback.href, store: f.options.store, fetch: f.fetch, now: f.options.now })).toEqual({ resource });
  expect(f.saved()?.tokens?.accessToken).toBe("private-token");
});
