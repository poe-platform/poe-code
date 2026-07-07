import { describe, expect, it, vi } from "vitest";

import { createHTTPMCPAuthorization } from "./http.js";

describe("createHTTPMCPAuthorization", () => {
  it("adapts authorization-server verification to Toolcraft HTTP auth context", async () => {
    const verifyAccessToken = vi.fn(async () => ({
      subject: "baby-daybook:user-a",
      clientId: "mcp-client",
      resource: "https://mcp.example.com/mcp",
      scopes: ["mcp.read"],
      tokenId: "token-id",
      expiresAt: 1_800_000_000_000
    }));
    const oauth = createHTTPMCPAuthorization({
      authorizationServer: {
        issuer: "https://auth.example.com",
        verifyAccessToken
      },
      resource: "https://mcp.example.com/mcp",
      requiredScopes: ["mcp.read"]
    });

    expect(oauth.authorizationServers).toEqual(["https://auth.example.com"]);
    expect(oauth.resource).toBe("https://mcp.example.com/mcp");
    const verified = await oauth.verifier.verify({
      token: "access-token",
      resource: "https://mcp.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: ["mcp.read"]
    });

    expect(verifyAccessToken).toHaveBeenCalledWith(
      "access-token",
      "https://mcp.example.com/mcp"
    );
    expect(verified.subject).toBe("baby-daybook:user-a");
    expect(verified.clientId).toBe("mcp-client");
    expect(verified.claims).toMatchObject({ jti: "token-id" });
  });

  it("rejects verification attempts for a different issuer", async () => {
    const oauth = createHTTPMCPAuthorization({
      authorizationServer: {
        issuer: "https://auth.example.com",
        verifyAccessToken: vi.fn()
      },
      resource: "https://mcp.example.com/mcp"
    });

    await expect(
      oauth.verifier.verify({
        token: "access-token",
        resource: "https://mcp.example.com/mcp",
        authorizationServers: ["https://other.example.com"],
        requiredScopes: []
      })
    ).rejects.toThrow("authorization server issuer does not match");
  });
});
