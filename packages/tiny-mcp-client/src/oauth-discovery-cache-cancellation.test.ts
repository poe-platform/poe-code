import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { OAuthMetadataDiscovery, type OAuthDiscoveryCache, type OAuthDiscoveryResult } from "./oauth-discovery.js";
const resource = "https://resource.example/mcp", issuer = "https://issuer.example";
function metadata(): OAuthDiscoveryResult { return { resource, resourceMetadataUrl: "https://resource.example/.well-known/oauth-protected-resource/mcp",
  resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
  authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } }; }

it.each(["get", "set", "delete"] as const)("settles discovery cancellation while host cache %s waits", async method => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  const invalid = metadata(); invalid.authorizationServerMetadata.issuer = "https://wrong.example";
  const cache: OAuthDiscoveryCache = { get: async () => method === "delete" ? invalid : null, set: async () => {}, delete: async () => {} };
  if (method === "get") cache.get = async () => { entered.resolve(); await release.promise; return null; };
  else cache[method] = async () => { entered.resolve(); await release.promise; };
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).includes("oauth-protected-resource") ? metadata().resourceMetadata : metadata().authorizationServerMetadata));
  const discovery = new OAuthMetadataDiscovery({ cache, fetch }), reason = new Error(`cancel host cache ${method}`);
  const pending = discovery.discover(resource, { signal: controller.signal }).catch(error => error);
  try {
    await entered.promise; controller.abort(reason);
    expect(await Promise.race([pending, setImmediate().then(() => "still waiting for host cache")])).toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(method === "set" ? 2 : 0);
  } finally { release.resolve(); await pending; }
  await setImmediate(); expect(fetch).toHaveBeenCalledTimes(method === "set" ? 2 : 0);
});

it("observes a late host cache rejection after cancellation without starting metadata fetches", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  const fetch = vi.fn(async () => Response.json({})), reason = new Error("cancel cache before late rejection");
  const pending = new OAuthMetadataDiscovery({ fetch, cache: { get: async () => { entered.resolve(); await release.promise; return null; }, set: async () => {} } })
    .discover(resource, { signal: controller.signal }).catch(error => error);
  try {
    await entered.promise; controller.abort(reason);
    expect(await pending).toBe(reason);
  } finally { release.reject(new Error("late host cache failure")); await pending; }
  await setImmediate(); expect(fetch).not.toHaveBeenCalled();
});
