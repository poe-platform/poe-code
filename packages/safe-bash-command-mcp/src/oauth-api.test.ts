import { expect, it } from "vitest";
import * as api from "./index.js";
import { exchangeAuthorizationCode, refreshAccessToken, revokeOAuthToken, registerOAuthClient } from "mcp-oauth";
import { discoverOAuthMetadata } from "tiny-mcp-client";

it("exposes the existing OAuth implementation to hosts through the bundled MCP API", () => {
  expect(api.exchangeAuthorizationCode).toBe(exchangeAuthorizationCode);
  expect(api.refreshAccessToken).toBe(refreshAccessToken);
  expect(api.registerOAuthClient).toBe(registerOAuthClient);
  expect(api.revokeOAuthToken).toBe(revokeOAuthToken);
  expect(api.discoverOAuthMetadata).toBe(discoverOAuthMetadata);
  expect(api.prepareRemoteMcpAuthorization).toEqual(expect.any(Function));
});


it("preserves an eight-request host budget for discovery plus refresh through the bundled API", async () => {
  const issuer = "https://mcp.notion.com";
  let attempts = 0;
  const fetch = async (input: string | URL, init?: RequestInit) => {
    if (++attempts > 8) throw new Error("request budget exhausted");
    const url = new URL(input);
    if (url.origin !== issuer) throw new Error("foreign host denied");
    if (url.pathname === "/.well-known/oauth-protected-resource") return Response.json({ resource: issuer,
      authorization_servers: ["https://foreign0.example/as", "https://foreign1.example/as", issuer, "https://foreign2.example/as"] });
    if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json({ issuer,
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    expect(init?.method).toBe("POST");
    expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("refresh_token");
    return Response.json({ access_token: "synthetic", token_type: "Bearer", expires_in: 3600 });
  };
  const refresh = async (expectedIssuer?: string) => {
    const discovery = await api.discoverOAuthMetadata(issuer, { fetch, expectedIssuer });
    return api.refreshAccessToken({ tokenEndpoint: discovery.authorizationServerMetadata.token_endpoint,
      clientId: "synthetic", refreshToken: "synthetic", resource: issuer, fetch, now: () => 1_800_000_000_000 });
  };
  await expect(refresh()).rejects.toThrow("request budget exhausted");
  expect(attempts).toBe(9);
  attempts = 0;
  await expect(refresh(issuer)).resolves.toMatchObject({ accessToken: "synthetic" });
  expect(attempts).toBe(3);
});
