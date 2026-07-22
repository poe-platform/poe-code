import { createHash, generateKeyPairSync } from "node:crypto";
import { exportJWK, jwtVerify } from "jose";
import { createJwksTokenVerifier } from "mcp-oauth";
import { describe, expect, it } from "vitest";

import {
  createInMemoryAuthorizationServerStore,
  createOAuthAuthorizationServer,
  type AuthorizationInteraction
} from "./index.js";

const issuer = "https://auth.example.com";
const resource = "https://mcp.example.com/mcp";
const redirectUri = "http://127.0.0.1:43123/callback";
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function createServer() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = await exportJWK(publicKey);
  const startedTransactions: string[] = [];
  const interaction: AuthorizationInteraction = {
    async start({ transaction }) {
      startedTransactions.push(transaction.id);
      return new Response("authorize", { status: 200 });
    }
  };
  const server = createOAuthAuthorizationServer({
    issuer,
    resources: [resource],
    scopesSupported: ["mcp.read", "offline_access"],
    defaultScopes: ["mcp.read", "offline_access"],
    signingKey: {
      algorithm: "ES256",
      keyId: "test-key",
      privateKey,
      publicJwk
    },
    store: createInMemoryAuthorizationServerStore(),
    interaction
  });

  return { server, startedTransactions, publicKey };
}

async function registerClient(server: Awaited<ReturnType<typeof createServer>>["server"]) {
  const response = await server.handle(
    new Request(`${issuer}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      })
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string };
}

async function authorize(
  server: Awaited<ReturnType<typeof createServer>>["server"],
  clientId: string,
  requestedRedirectUri = redirectUri
) {
  const url = new URL(`${issuer}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", requestedRedirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", resource);
  url.searchParams.set("scope", "mcp.read offline_access");
  url.searchParams.set("state", "client-state");
  return server.handle(new Request(url));
}

async function exchangeCode(input: {
  server: Awaited<ReturnType<typeof createServer>>["server"];
  clientId: string;
  code: string;
}) {
  return input.server.handle(
    new Request(`${issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: input.clientId,
        code: input.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource
      })
    })
  );
}

describe("createOAuthAuthorizationServer", () => {
  it("runs authorization code with PKCE and propagates the approved subject", async () => {
    const { server, startedTransactions, publicKey } = await createServer();
    const client = await registerClient(server);

    const authorizationResponse = await authorize(server, client.client_id);
    expect(authorizationResponse.status).toBe(200);
    expect(startedTransactions).toHaveLength(1);

    const completion = await server.completeAuthorization({
      transactionId: startedTransactions[0]!,
      subject: "baby-daybook:user-a"
    });
    expect(completion.redirectUrl.searchParams.get("state")).toBe("client-state");
    expect(completion.redirectUrl.searchParams.get("iss")).toBe(issuer);

    const tokenResponse = await exchangeCode({
      server,
      clientId: client.client_id,
      code: completion.redirectUrl.searchParams.get("code")!
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const verified = await jwtVerify(tokens.access_token, publicKey, {
      issuer,
      audience: resource
    });
    expect(verified.payload.sub).toBe("baby-daybook:user-a");
    expect(verified.payload.client_id).toBe(client.client_id);
    expect(tokens.refresh_token).toBeTypeOf("string");
    await expect(server.verifyAccessToken(tokens.access_token, resource)).resolves.toMatchObject({
      subject: "baby-daybook:user-a",
      clientId: client.client_id,
      resource,
      scopes: ["mcp.read", "offline_access"]
    });
    const externalVerifier = createJwksTokenVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      fetch: (input) => server.handle(new Request(input))
    });
    await expect(
      externalVerifier.verify({
        token: tokens.access_token,
        resource,
        authorizationServers: [issuer],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      subject: "baby-daybook:user-a",
      clientId: client.client_id,
      audience: [resource]
    });

    const revokeResponse = await server.handle(
      new Request(`${issuer}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.access_token })
      })
    );
    expect(revokeResponse.status).toBe(200);
    await expect(server.verifyAccessToken(tokens.access_token, resource)).rejects.toThrow(
      "Access token is revoked"
    );
  });

  it("requires exact registered redirect URI matching", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);

    const response = await authorize(
      server,
      client.client_id,
      "http://127.0.0.1:43123/callback/extra"
    );

    expect(response.status).toBe(400);
    expect(startedTransactions).toHaveLength(0);
  });

  it("rejects authorization scopes outside the configured allowlist", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", resource);
    url.searchParams.set("scope", "mcp.admin");

    const response = await server.handle(new Request(url));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_scope" });
    expect(startedTransactions).toHaveLength(0);
  });

  it("uses configured defaults when authorization omits scope", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", resource);

    const authorizationResponse = await server.handle(new Request(url));
    expect(authorizationResponse.status).toBe(200);
    const completion = await server.completeAuthorization({
      transactionId: startedTransactions[0]!,
      subject: "baby-daybook:user-a"
    });
    const tokenResponse = await exchangeCode({
      server,
      clientId: client.client_id,
      code: completion.redirectUrl.searchParams.get("code")!
    });
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };

    expect(tokens.scope).toBe("mcp.read offline_access");
    expect(tokens.refresh_token).toBeTypeOf("string");
    await expect(server.verifyAccessToken(tokens.access_token, resource)).resolves.toMatchObject({
      scopes: ["mcp.read", "offline_access"]
    });
  });

  it("rejects an explicitly empty scope when non-empty defaults are configured", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);
    const url = new URL(`${issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", resource);
    url.searchParams.set("scope", "");

    const response = await server.handle(new Request(url));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_scope" });
    expect(startedTransactions).toHaveLength(0);
  });

  it("rejects configured default scopes outside the supported scopes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const publicJwk = await exportJWK(publicKey);

    expect(() =>
      createOAuthAuthorizationServer({
        issuer,
        resources: [resource],
        scopesSupported: ["mcp.read"],
        defaultScopes: ["mcp.admin"],
        signingKey: {
          algorithm: "ES256",
          keyId: "test-key",
          privateKey,
          publicJwk
        },
        store: createInMemoryAuthorizationServerStore(),
        interaction: { start: () => new Response("authorize") }
      })
    ).toThrow(/default scopes.*supported/i);
  });

  it("rotates refresh tokens and revokes the family when an old token is replayed", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);
    await authorize(server, client.client_id);
    const completion = await server.completeAuthorization({
      transactionId: startedTransactions[0]!,
      subject: "baby-daybook:user-a"
    });
    const initialResponse = await exchangeCode({
      server,
      clientId: client.client_id,
      code: completion.redirectUrl.searchParams.get("code")!
    });
    const initial = (await initialResponse.json()) as { refresh_token: string };

    const rotate = (refreshToken: string) =>
      server.handle(
        new Request(`${issuer}/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: client.client_id,
            refresh_token: refreshToken,
            resource
          })
        })
      );

    const rotatedResponse = await rotate(initial.refresh_token);
    expect(rotatedResponse.status).toBe(200);
    const rotated = (await rotatedResponse.json()) as { refresh_token: string };
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);

    const replayResponse = await rotate(initial.refresh_token);
    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toMatchObject({ error: "invalid_grant" });

    const familyResponse = await rotate(rotated.refresh_token);
    expect(familyResponse.status).toBe(400);
    await expect(familyResponse.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("publishes authorization-server metadata and JWKS", async () => {
    const { server } = await createServer();

    const metadata = await server.handle(
      new Request(`${issuer}/.well-known/oauth-authorization-server`)
    );
    await expect(metadata.json()).resolves.toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      code_challenge_methods_supported: ["S256"]
    });

    const jwks = await server.handle(new Request(`${issuer}/.well-known/jwks.json`));
    await expect(jwks.json()).resolves.toMatchObject({
      keys: [{ kid: "test-key", alg: "ES256", use: "sig" }]
    });
  });

  it("revokes one subject grant without affecting another subject", async () => {
    const { server, startedTransactions } = await createServer();
    const client = await registerClient(server);

    await authorize(server, client.client_id);
    const first = await server.completeAuthorization({
      transactionId: startedTransactions.shift()!,
      subject: "baby-daybook:user-a"
    });
    const firstTokens = (await (
      await exchangeCode({
        server,
        clientId: client.client_id,
        code: first.redirectUrl.searchParams.get("code")!
      })
    ).json()) as { access_token: string };

    await authorize(server, client.client_id);
    const second = await server.completeAuthorization({
      transactionId: startedTransactions.shift()!,
      subject: "baby-daybook:user-b"
    });
    const secondTokens = (await (
      await exchangeCode({
        server,
        clientId: client.client_id,
        code: second.redirectUrl.searchParams.get("code")!
      })
    ).json()) as { access_token: string };

    await server.revokeGrant(first.grantId);

    await expect(server.verifyAccessToken(firstTokens.access_token, resource)).rejects.toThrow();
    await expect(
      server.verifyAccessToken(secondTokens.access_token, resource)
    ).resolves.toMatchObject({ subject: "baby-daybook:user-b" });
  });

  it("rejects oversized registration and token requests", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const server = createOAuthAuthorizationServer({
      issuer,
      resources: [resource],
      signingKey: {
        algorithm: "ES256",
        keyId: "test-key",
        privateKey,
        publicJwk: await exportJWK(publicKey)
      },
      store: createInMemoryAuthorizationServerStore(),
      interaction: { start: () => new Response("authorize") },
      maxRequestBodyBytes: 32
    });

    const response = await server.handle(
      new Request(`${issuer}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirectUri] })
      })
    );

    expect(response.status).toBe(413);
  });
});
