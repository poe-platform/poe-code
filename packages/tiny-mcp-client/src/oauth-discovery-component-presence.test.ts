import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, type OAuthDiscoveryResult } from "./index.js";
import { resolveAuthorizationServerMetadataUrl, resolveProtectedResourceMetadataUrl } from "./oauth-discovery.js";

const resource = "https://resource.example/mcp", issuer = "https://auth.example/issuer";
const valid: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: "https://resource.example/.well-known/oauth-protected-resource/mcp",
  resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServer: issuer,
  authorizationServerMetadataUrl: "https://auth.example/.well-known/oauth-authorization-server/issuer",
  authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }
};

it.each(["#private-fragment", "#"])("rejects resource lookup fragments before canonicalization: %#", fragment => {
  expect(() => resolveProtectedResourceMetadataUrl(resource + fragment)).toThrow("credentials or fragment");
});

it.each(["#private-fragment", "#"])("does not read caches for an invalid original resource fragment: %#", async fragment => {
  const get = vi.fn(() => valid), fetch = vi.fn(async () => { throw new Error("unexpected network"); });
  await expect(discoverOAuthMetadata(resource + fragment, { fetch, cache: { get, set: vi.fn() } })).rejects.toThrow("credentials or fragment");
  expect(get).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it("rejects an explicit empty metadata fragment before network", async () => {
  const fetch = vi.fn(async () => { throw new Error("unexpected network"); });
  await expect(discoverOAuthMetadata(resource, { resourceMetadataUrl: `${valid.resourceMetadataUrl}#`, fetch })).rejects.toThrow("credentials or fragment");
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["?", "#"])("rejects issuer identifiers containing an empty %s component", delimiter => {
  expect(() => resolveAuthorizationServerMetadataUrl(issuer + delimiter)).toThrow("query or fragment");
});

it.each(["authorization_endpoint", "token_endpoint", "registration_endpoint"])("rejects empty fragments in advertised %s", async field => {
  const set = vi.fn(), fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === valid.resourceMetadataUrl
    ? valid.resourceMetadata : { ...valid.authorizationServerMetadata, [field]: `${issuer}/endpoint#` }));
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: valid.resourceMetadataUrl, cache: { get: () => null, set } })).rejects.toThrow(`${field} must not include credentials or fragment`);
  expect(set).not.toHaveBeenCalled();
});

it("evicts an empty fragment on a cached metadata location", async () => {
  const cached = structuredClone(valid); cached.resourceMetadataUrl += "#";
  const cache = { get: () => cached, delete: vi.fn(), set: vi.fn() };
  const fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === valid.resourceMetadataUrl ? valid.resourceMetadata : valid.authorizationServerMetadata));
  expect(await discoverOAuthMetadata(resource, { fetch, cache })).toEqual(valid);
  expect(cache.delete).toHaveBeenCalledExactlyOnceWith(resource); expect(fetch).toHaveBeenCalledTimes(2);
});

it("retains valid resource queries and escaped component delimiters", () => {
  expect(resolveProtectedResourceMetadataUrl("https://resource.example/mcp%23name?tenant=%23value")).toBe("https://resource.example/.well-known/oauth-protected-resource/mcp%23name?tenant=%23value");
  expect(resolveProtectedResourceMetadataUrl(resource, "https://resource.example/metadata?tenant=%23value")).toBe("https://resource.example/metadata?tenant=%23value");
  expect(resolveAuthorizationServerMetadataUrl("https://auth.example/issuer%3F%23")).toBe("https://auth.example/.well-known/oauth-authorization-server/issuer%3F%23");
});
