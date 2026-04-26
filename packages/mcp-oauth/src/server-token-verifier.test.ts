import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server/testing";
import { createOAuthTestServer } from "tiny-oauth-test-server";
import { createJwksTokenVerifier } from "./index.js";

describe("createJwksTokenVerifier", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  async function listenOAuthServer() {
    const oauth = createOAuthTestServer({
      signingKeySeed: "mcp-oauth:create-jwks-token-verifier",
      defaultTokenTtlSeconds: 60,
    });
    const handle = await oauth.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);
    return oauth;
  }

  it("verifies a JWT against the published JWKS", async () => {
    const oauth = await listenOAuthServer();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: nodeFetch,
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"],
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"],
      })
    ).resolves.toMatchObject({
      token,
      issuer: oauth.issuer,
      audience: ["https://resource.example.com/mcp"],
      scopes: ["mcp.read"],
      clientId: "demo-client",
    });
  });

  it("rejects tokens whose audience does not match the protected resource", async () => {
    const oauth = await listenOAuthServer();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: nodeFetch,
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/other",
      scopes: ["mcp.read"],
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: [],
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "audience mismatch",
    });
  });

  it("accepts a configured resource URI that is canonically equivalent to the token audience", async () => {
    const oauth = await listenOAuthServer();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: nodeFetch,
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"],
    });

    await expect(
      verifier.verify({
        token,
        resource: "HTTPS://RESOURCE.EXAMPLE.COM:443/mcp#ignored",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"],
      })
    ).resolves.toMatchObject({
      audience: ["https://resource.example.com/mcp"],
    });
  });

  it("rejects tokens that contain multiple audiences", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read",
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT",
      })
      .setIssuer("https://auth.example.com")
      .setAudience([
        "https://resource.example.com/mcp",
        "https://resource.example.com/other",
      ])
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"],
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "audience mismatch",
    });
  });

  it("rejects tokens that do not satisfy the required scopes", async () => {
    const oauth = await listenOAuthServer();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: nodeFetch,
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.write"],
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"],
      })
    ).rejects.toMatchObject({
      error: "insufficient_scope",
      errorDescription: "insufficient scope",
      scope: ["mcp.read"],
    });
  });
});
