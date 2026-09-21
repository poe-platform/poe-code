import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, OAuthMetadataError, type OAuthDiscoveryResult } from "./index.js";

const resource = "https://resource.example/mcp?tenant=005930", issuer = "https://auth.example/issuer";
const valid: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: "https://resource.example/.well-known/oauth-protected-resource/mcp?tenant=005930",
  resourceMetadata: { resource, authorization_servers: [issuer], extension: { exact: "005930" } },
  authorizationServer: issuer, authorizationServerMetadataUrl: "https://auth.example/.well-known/oauth-authorization-server/issuer",
  authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }
};

it.each(["#private-fragment", "#"])("rejects advertised resource fragments before issuer discovery: %#", async fragment => {
  const set = vi.fn(), fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === valid.resourceMetadataUrl
    ? { ...valid.resourceMetadata, resource: `${resource}${fragment}` } : valid.authorizationServerMetadata));
  const failure = await discoverOAuthMetadata(resource, { fetch, cache: { get: () => null, set }, resourceMetadataUrl: valid.resourceMetadataUrl }).catch(error => error);
  expect(OAuthMetadataError.is(failure)).toBe(true);
  expect(failure).toMatchObject({ phase: "protected-resource", message: "Protected resource metadata resource must not include fragment" });
  expect(fetch).toHaveBeenCalledOnce(); expect(set).not.toHaveBeenCalled();
});

it("evicts cached metadata with a resource fragment and retains the exact resource query", async () => {
  const cached = structuredClone(valid); cached.resourceMetadata.resource += "#private-fragment";
  const cache = { get: vi.fn(() => cached), delete: vi.fn(), set: vi.fn() };
  const fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === valid.resourceMetadataUrl ? valid.resourceMetadata : valid.authorizationServerMetadata));
  expect(await discoverOAuthMetadata(resource, { fetch, cache })).toEqual(valid);
  expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([valid.resourceMetadataUrl, valid.authorizationServerMetadataUrl]);
  expect(cache.delete).toHaveBeenCalledExactlyOnceWith(resource);
  expect(cache.set).toHaveBeenCalledExactlyOnceWith(resource, valid);
});

it("retains escaped hash data in valid resource paths and queries", async () => {
  const exact = "https://resource.example/mcp%23name?tenant=%23value", location = "https://resource.example/.well-known/oauth-protected-resource/mcp%23name?tenant=%23value";
  const fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === location ? { ...valid.resourceMetadata, resource: exact } : valid.authorizationServerMetadata));
  expect(await discoverOAuthMetadata(exact, { fetch })).toEqual({ ...valid, resource: exact, resourceMetadataUrl: location, resourceMetadata: { ...valid.resourceMetadata, resource: exact } });
});
