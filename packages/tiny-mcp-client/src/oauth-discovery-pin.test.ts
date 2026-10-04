import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, OAuthMetadataDiscovery } from "./oauth-discovery.js";
import { discoverOAuthMetadata as browserDiscovery } from "./index.browser.js";

const resource = "https://resource.example/mcp";
const issuer = "https://auth.example/tenant";
const hint = "https://resource.example/metadata";
const locations = [
  "https://auth.example/.well-known/oauth-authorization-server/tenant",
  "https://auth.example/.well-known/openid-configuration/tenant",
  `${issuer}/.well-known/openid-configuration`
];
const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
function transport(servers: unknown = ["https://foreign.example/as", issuer, "https://other.example/as"], success = locations[0]) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === hint) return Response.json({ resource, authorization_servers: servers });
    if (url === success) return Response.json(metadata);
    return new Response(null, { status: 404 });
  });
}

it.each(locations)("pins discovery before probes, preserving fallback %s", async success => {
  const fetch = transport(undefined, success);
  const result = await discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer });
  expect(result.authorizationServer).toBe(issuer);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([hint, ...locations.slice(0, locations.indexOf(success) + 1)]);
});
it.each([{ servers: ["https://foreign.example/as"] }, { servers: [issuer + "/"] }])("rejects absent exact pin: $servers", async ({ servers }) => {
  const fetch = transport(servers);
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer })).rejects.toMatchObject({ reason: "issuer-mismatch", phase: "authorization-server" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not retry duplicate pins after all fallbacks fail", async () => {
  const fetch = transport([issuer, issuer], "none");
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer })).rejects.toThrow();
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([hint, ...locations]);
});
it.each([{ servers: [issuer, 42] }, { servers: [issuer, null] }, { servers: [] }])("retains malformed array validation $servers", async ({ servers }) => {
  const fetch = transport(servers);
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer })).rejects.toThrow("authorization_servers");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("ignores malformed unselected issuer strings", async () => {
  const fetch = transport(["bad url", issuer, "http://unsafe.example"]);
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer })).resolves.toMatchObject({ authorizationServer: issuer });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(["bad url", "http://unsafe.example", issuer + "?", issuer + "#"])("rejects invalid pin before IO: %s", async expectedIssuer => {
  const fetch = transport();
  await expect(discoverOAuthMetadata(resource, { fetch, expectedIssuer })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("stops pinned fallback discovery on cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("canceled");
  const fetch = transport();
  fetch.mockImplementationOnce(async () => Response.json({ resource, authorization_servers: [issuer] }));
  fetch.mockImplementationOnce(async () => { controller.abort(reason); throw reason; });
  await expect(discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer, signal: controller.signal })).rejects.toBe(reason);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not reuse an unpinned cached result for another issuer", async () => {
  const fetch = transport();
  const cached = await discoverOAuthMetadata(resource, { fetch, resourceMetadataUrl: hint });
  fetch.mockClear();
  const discovery = new OAuthMetadataDiscovery({ fetch, cache: { get: () => cached, set: vi.fn() } });
  await expect(discovery.discover(resource)).resolves.toEqual(cached);
  await expect(discovery.discover(resource, { expectedIssuer: "https://other.example" })).rejects.toThrow();
  expect(fetch).toHaveBeenCalled();
});
it("supports pinned discovery through the browser export", async () => {
  const fetch = transport();
  const result = await browserDiscovery(resource, { fetch, resourceMetadataUrl: hint, expectedIssuer: issuer });
  expect(result.authorizationServer).toBe(issuer);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reuses matching shared and memory cache entries with a pin", async () => {
  const cached = await discoverOAuthMetadata(resource, { fetch: transport(), resourceMetadataUrl: hint });
  const fetch = transport();
  const get = vi.fn(() => cached);
  const discovery = new OAuthMetadataDiscovery({ fetch, cache: { get, set: vi.fn() } });
  await expect(discovery.discover(resource, { expectedIssuer: issuer })).resolves.toEqual(cached);
  await expect(discovery.discover(resource, { expectedIssuer: issuer })).resolves.toEqual(cached);
  expect(get).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("retains protected-resource root fallback when pinned", async () => {
  const root = "https://resource.example/.well-known/oauth-protected-resource";
  const fetch = transport();
  fetch.mockImplementationOnce(async () => new Response(null, { status: 404 }));
  fetch.mockImplementationOnce(async () => Response.json({ resource, authorization_servers: [issuer] }));
  await expect(discoverOAuthMetadata(resource, { fetch, expectedIssuer: issuer })).resolves.toMatchObject({ resourceMetadataUrl: root });
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([root + "/mcp", root, locations[0]]);
});
