import { describe, expect, it, vi } from "vitest";
import { discoverOAuthMetadata } from "./oauth-discovery.js";

const resource = "https://resource.example.com/tenant/mcp";
const issuer = "https://auth.example.com/tenant";
const pathMetadata = "https://resource.example.com/.well-known/oauth-protected-resource/tenant/mcp";
const rootMetadata = "https://resource.example.com/.well-known/oauth-protected-resource";
const authorizationMetadata =
  "https://auth.example.com/.well-known/oauth-authorization-server/tenant";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

describe("OAuth protected-resource discovery fallback", () => {
  it.each(["missing", "invalid"])(
    "tries root metadata after %s endpoint metadata",
    async (failure) => {
      const fetch = vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === pathMetadata) {
          return failure === "missing" ? new Response(null, { status: 404 }) : json({ resource });
        }
        if (url === rootMetadata) return json({ resource, authorization_servers: [issuer] });
        if (url === authorizationMetadata)
          return json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"]
          });
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await discoverOAuthMetadata(resource, { fetch });

      expect(result.resourceMetadataUrl).toBe(rootMetadata);
      expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
        pathMetadata,
        rootMetadata,
        authorizationMetadata
      ]);
    }
  );

  it("uses only an explicit metadata challenge URL", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      discoverOAuthMetadata(resource, {
        fetch,
        resourceMetadataUrl: "https://resource.example.com/hinted-metadata"
      })
    ).rejects.toThrow("Protected resource metadata request failed (404)");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not request the root well-known endpoint twice for a root resource", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      discoverOAuthMetadata("https://resource.example.com", { fetch })
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
