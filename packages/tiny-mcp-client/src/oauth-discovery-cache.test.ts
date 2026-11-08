import { describe, expect, it, vi } from "vitest";
import {
  OAuthMetadataDiscovery,
  type OAuthDiscoveryResult,
  discoverOAuthMetadata
} from "./oauth-discovery.js";

const resource = "https://resource.example.com/mcp";
const issuer = "https://auth.example.com/tenant";

function validResult(): OAuthDiscoveryResult {
  return {
    resource,
    resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
    resourceMetadata: { resource, authorization_servers: [issuer] },
    authorizationServer: issuer,
    authorizationServerMetadataUrl:
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant",
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"]
    }
  };
}

function networkFetch() {
  return vi.fn(
    async (input: string | URL) =>
      new Response(
        JSON.stringify(
          input.toString().includes("oauth-protected-resource")
            ? validResult().resourceMetadata
            : validResult().authorizationServerMetadata
        )
      )
  );
}

describe("OAuth discovery cache validation", () => {
  it.each([
    "resource",
    "resource metadata",
    "issuer",
    "unadvertised issuer",
    "insecure token",
    "metadata location",
    "relative resource location",
    "credential resource location",
    "fragment resource location"
  ])("discards cached %s tampering and uses validated network metadata", async (tampering) => {
    const cached = validResult();
    switch (tampering) {
      case "resource":
        cached.resource = "https://other.example.com/mcp";
        break;
      case "resource metadata":
        cached.resourceMetadata.resource = "https://other.example.com/mcp";
        break;
      case "issuer":
        cached.authorizationServerMetadata.issuer = "https://other.example.com";
        break;
      case "unadvertised issuer":
        cached.resourceMetadata.authorization_servers = ["https://other.example.com"];
        break;
      case "insecure token":
        cached.authorizationServerMetadata.token_endpoint = "http://other.example.com/token";
        break;
      case "metadata location":
        cached.authorizationServerMetadataUrl = "https://other.example.com/metadata";
        break;
      case "relative resource location":
        cached.resourceMetadataUrl = "/metadata";
        break;
      case "credential resource location":
        cached.resourceMetadataUrl = "https://user:secret@resource.example.com/metadata";
        break;
      case "fragment resource location":
        cached.resourceMetadataUrl = "https://resource.example.com/metadata#fragment";
        break;
    }
    const fetch = networkFetch();
    const cache = { get: vi.fn(() => cached), set: vi.fn(), delete: vi.fn() };

    const result = await discoverOAuthMetadata(resource, { fetch, cache });

    expect(result).toEqual(validResult());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.delete).toHaveBeenCalledWith(resource);
    expect(cache.set).toHaveBeenCalledWith(resource, validResult());
  });

  it("keeps caller mutations from poisoning the private memory cache", async () => {
    const fetch = networkFetch();
    const discovery = new OAuthMetadataDiscovery({ fetch });
    const result = await discovery.discover(resource);
    result.authorizationServerMetadata.token_endpoint = "http://other.example.com/token";
    result.resourceMetadata.authorization_servers.push("https://other.example.com");

    expect(await discovery.discover(resource)).toEqual(validResult());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses a valid injected cache without network discovery", async () => {
    const fetch = networkFetch();
    const cache = { get: vi.fn(validResult), set: vi.fn() };
    expect(await discoverOAuthMetadata(resource, { fetch, cache })).toEqual(validResult());
    expect(fetch).not.toHaveBeenCalled();
  });
});

it.each(["throw", "abort"] as const)("does not consult an unrelated shared cache during explicit metadata discovery: %s", async behavior => {
  const controller = new AbortController(), hint = "https://resource.example.com/explicit-metadata?tenant=one";
  const get = vi.fn(() => {
    if (behavior === "throw") throw new Error("unrelated cache is unavailable");
    controller.abort(new Error("unrelated cache canceled lookup")); return validResult();
  }), set = vi.fn();
  const fetch = vi.fn(async (input: string | URL) => Response.json(String(input) === hint ? validResult().resourceMetadata : validResult().authorizationServerMetadata));
  await expect(discoverOAuthMetadata(resource, { cache: { get, set }, fetch, signal: controller.signal, resourceMetadataUrl: hint })).resolves.toEqual({ ...validResult(), resourceMetadataUrl: hint });
  expect(get).not.toHaveBeenCalled(); expect(set).toHaveBeenCalledWith(resource, { ...validResult(), resourceMetadataUrl: hint });
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([hint, validResult().authorizationServerMetadataUrl]);
});
