import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createOAuthTestServer } from "./index.js";

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function normalizeRequestHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: init.method ?? "GET",
        hostname: normalizeRequestHostname(url.hostname),
        port: url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders.set(key, value);
            continue;
          }

          if (Array.isArray(value)) {
            responseHeaders.set(key, value.join(", "));
          }
        }

        const body =
          response.statusCode === 204
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    request.on("error", reject);

    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      request.write(init.body);
    }

    request.end();
  });
}

async function verifyToken(input: {
  issuer: string;
  resource: string;
  token: string;
}) {
  const jwksResponse = await nodeFetch(`${input.issuer}/.well-known/jwks.json`);
  const jwks = createLocalJWKSet(
    (await jwksResponse.json()) as {
      keys: Array<Record<string, unknown>>;
    }
  );

  return jwtVerify(input.token, jwks, {
    issuer: input.issuer,
    audience: input.resource,
  });
}

async function registerClient(input: {
  baseUrl: string;
  redirectUris: string[];
  scope?: string;
}): Promise<string> {
  const response = await nodeFetch(`${input.baseUrl}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      redirect_uris: input.redirectUris,
      scope: input.scope,
    }),
  });

  expect(response.status).toBe(201);

  const payload = (await response.json()) as { client_id: string };
  return payload.client_id;
}

async function authorize(input: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  scope?: string;
  state?: string;
}): Promise<{ code: string; state: string | null }> {
  const url = new URL(`${input.baseUrl}/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  url.searchParams.set("auto_approve", "1");

  if (input.scope !== undefined) {
    url.searchParams.set("scope", input.scope);
  }

  if (input.state !== undefined) {
    url.searchParams.set("state", input.state);
  }

  const response = await nodeFetch(url, {
    redirect: "manual",
  });

  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();

  const callbackUrl = new URL(location ?? "");
  const code = callbackUrl.searchParams.get("code");
  expect(code).toBeTruthy();

  return {
    code: code ?? "",
    state: callbackUrl.searchParams.get("state"),
  };
}

async function exchangeAuthorizationCode(input: {
  baseUrl: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
}): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    resource: input.resource,
  });

  return nodeFetch(`${input.baseUrl}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

async function refreshAccessToken(input: {
  baseUrl: string;
  clientId: string;
  refreshToken: string;
  resource: string;
}): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    resource: input.resource,
  });

  return nodeFetch(`${input.baseUrl}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

describe("tiny-oauth-test-server", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  async function listenServer() {
    const server = createOAuthTestServer({
      defaultTokenTtlSeconds: 60,
      signingKeySeed: "tiny-oauth-test-server:test-seed",
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);
    return { server, handle };
  }

  it("serves RFC 8414 authorization server metadata", async () => {
    const { server } = await listenServer();

    const response = await nodeFetch(
      `${server.issuer}/.well-known/oauth-authorization-server`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      issuer: server.issuer,
      authorization_endpoint: `${server.issuer}/authorize`,
      token_endpoint: `${server.issuer}/token`,
      registration_endpoint: `${server.issuer}/register`,
      jwks_uri: `${server.issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("round-trips register, authorize, and token into a verifiable JWT", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43123/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = "correct-horse-battery-staple";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
      scope: "mcp.read mcp.write",
    });

    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
      scope: "mcp.read mcp.write",
      state: "state-123",
    });

    expect(authorization.state).toBe("state-123");

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });

    expect(tokenResponse.status).toBe(200);
    const tokenPayload = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };

    expect(tokenPayload.token_type).toBe("Bearer");
    expect(tokenPayload.expires_in).toBe(60);
    expect(tokenPayload.refresh_token).toBeTruthy();

    const verified = await verifyToken({
      issuer: server.issuer,
      resource,
      token: tokenPayload.access_token,
    });

    expect(verified.payload.iss).toBe(server.issuer);
    expect(verified.payload.aud).toBe(resource);
    expect(verified.payload.scope).toBe("mcp.read mcp.write");
    expect(verified.payload.exp).toBe(verified.payload.iat! + 60);
  });

  it("rejects a PKCE verifier mismatch", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43124/callback";
    const resource = "https://resource.example.com/mcp";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge("expected-verifier"),
    });

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier: "wrong-verifier",
      redirectUri,
      resource,
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rejects a resource mismatch between authorize and token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43125/callback";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource: "https://resource.example.com/a",
      codeChallenge: createPkceChallenge("matching-verifier"),
    });

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier: "matching-verifier",
      redirectUri,
      resource: "https://resource.example.com/b",
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rotates refresh tokens and issues a new access token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43126/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = "refresh-flow-verifier";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
    });
    const firstTokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });
    const firstPayload = (await firstTokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };

    const refreshResponse = await refreshAccessToken({
      baseUrl: server.issuer,
      clientId,
      refreshToken: firstPayload.refresh_token,
      resource,
    });

    expect(refreshResponse.status).toBe(200);
    const refreshPayload = (await refreshResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };

    expect(refreshPayload.access_token).not.toBe(firstPayload.access_token);
    expect(refreshPayload.refresh_token).not.toBe(firstPayload.refresh_token);
  });

  it("rejects authorization codes after the first successful exchange", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43127/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = "single-use-code-verifier";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
    });

    const firstResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });

    expect(secondResponse.status).toBe(400);
    await expect(secondResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("issues direct tokens that verify against the published JWKS", async () => {
    const { server } = await listenServer();
    const resource = "https://resource.example.com/direct";

    const token = await server.issueTokenFor({
      clientId: "direct-client",
      resource,
      scopes: ["mcp.read"],
      ttlSeconds: 120,
    });

    const verified = await verifyToken({
      issuer: server.issuer,
      resource,
      token,
    });

    expect(verified.payload.client_id).toBe("direct-client");
    expect(verified.payload.scope).toBe("mcp.read");
    expect(verified.payload.exp).toBe(verified.payload.iat! + 120);
  });

  it("accepts IPv6 loopback redirect URIs", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://[::1]:43128/callback";
    const resource = "https://resource.example.com/ipv6";
    const codeVerifier = "ipv6-loopback-verifier";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });

    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
    });

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });

    expect(tokenResponse.status).toBe(200);
  });
});
