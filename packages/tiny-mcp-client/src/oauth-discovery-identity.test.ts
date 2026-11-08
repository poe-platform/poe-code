import { describe, expect, it, vi } from "vitest";
import { discoverOAuthMetadata } from "./oauth-discovery.js";

const resource = "https://resource.example.com/mcp";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"]
  };
}

describe("OAuth discovery issuer identity", () => {
  it.each([
    "https://auth.example.com/tenant/",
    "https://auth.example.com/",
    "https://AUTH.example.com:443/tenant"
  ])("preserves the advertised issuer identifier %s exactly", async (issuer) => {
    const fetch = vi.fn(async (input: string | URL) =>
      input.toString().includes("oauth-protected-resource")
        ? json({ resource, authorization_servers: [issuer] })
        : json(metadata(issuer))
    );
    const result = await discoverOAuthMetadata(resource, { fetch });
    expect(result.authorizationServer).toBe(issuer);
    expect(result.authorizationServerMetadata.issuer).toBe(issuer);
  });

  it("rejects metadata whose issuer differs only by a trailing slash", async () => {
    const fetch = vi.fn(async (input: string | URL) =>
      input.toString().includes("oauth-protected-resource")
        ? json({ resource, authorization_servers: ["https://auth.example.com/tenant/"] })
        : json(metadata("https://auth.example.com/tenant"))
    );
    await expect(discoverOAuthMetadata(resource, { fetch })).rejects.toThrow("issuer mismatch");
  });
});

describe("OAuth discovery endpoint validation", () => {
  it.each([
    ["authorization_endpoint", "http://auth.example.com/authorize"],
    ["token_endpoint", "http://auth.example.com/token"],
    ["registration_endpoint", "http://auth.example.com/register"],
    ["token_endpoint", "https://user:secret@auth.example.com/token"],
    ["authorization_endpoint", "https://auth.example.com/authorize#fragment"],
    ["token_endpoint", "/relative-token"],
    ["registration_endpoint", 123]
  ])("rejects invalid %s value %s before returning discovery", async (field, value) => {
    const issuer = "https://auth.example.com";
    const fetch = vi.fn(async (input: string | URL) =>
      input.toString().includes("oauth-protected-resource")
        ? json({ resource, authorization_servers: [issuer] })
        : json({ ...metadata(issuer), [field]: value })
    );
    await expect(discoverOAuthMetadata(resource, { fetch })).rejects.toThrow(String(field));
  });
});
