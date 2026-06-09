import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createOAuthTestServer } from "./index.js";

function hasOwnErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function createValidVerifier(label: string): string {
  return `${label}-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`;
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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
  codeChallengeMethod?: string;
  scope?: string;
  state?: string;
}): Promise<{ code: string; state: string | null; iss: string | null }> {
  const url = new URL(`${input.baseUrl}/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", input.codeChallengeMethod ?? "S256");
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
    iss: callbackUrl.searchParams.get("iss"),
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

async function reservePort(hostname: string): Promise<number> {
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    throw new Error("Expected temporary port reservation to bind to a TCP port");
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  return port;
}

describe("tiny-oauth-test-server", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
    vi.restoreAllMocks();
  });

  async function listenServer() {
    const server = createOAuthTestServer({
      defaultTokenTtlSeconds: 60,
      signingKeySeed: "tiny-oauth-test-server:test-seed",
      defaultAuthorization: { autoApprove: true },
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
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("rejects invalid configured issuers and numeric lifetime options", () => {
    expect(() => createOAuthTestServer({ issuer: "mailto:oauth@example.test" })).toThrow(
      "issuer must use http or https"
    );
    expect(() => createOAuthTestServer({ clockSkewSeconds: Infinity })).toThrow(
      "clockSkewSeconds must be a non-negative finite number"
    );
    expect(() => createOAuthTestServer({ clockSkewSeconds: -1 })).toThrow(
      "clockSkewSeconds must be a non-negative finite number"
    );
    expect(() => createOAuthTestServer({ defaultTokenTtlSeconds: Infinity })).toThrow(
      "defaultTokenTtlSeconds must be a positive integer"
    );
    expect(() => createOAuthTestServer({ defaultTokenTtlSeconds: -1 })).toThrow(
      "defaultTokenTtlSeconds must be a positive integer"
    );
  });

  it("rejects malformed static client configuration", () => {
    const redirectUri = "http://127.0.0.1:43123/callback";

    expect(() =>
      createOAuthTestServer({ staticClients: [{ clientId: "client", redirectUris: [] }] })
    ).toThrow("staticClients[].redirectUris must be a non-empty array");
    expect(() =>
      createOAuthTestServer({
        staticClients: [
          { clientId: "client", redirectUris: [redirectUri] },
          { clientId: "client", redirectUris: [redirectUri] }
        ]
      })
    ).toThrow("staticClients[].clientId must be unique");
    expect(() =>
      createOAuthTestServer({
        staticClients: [{ clientId: "client", redirectUris: [redirectUri], scopes: ["mcp.read mcp.admin"] }]
      })
    ).toThrow("scope entries must not contain spaces");
    expect(() =>
      createOAuthTestServer({ defaultAuthorization: { scopes: ["mcp.read mcp.admin"] } })
    ).toThrow("scope entries must not contain spaces");
  });

  it("enforces an explicitly empty static-client scope allowlist", async () => {
    const redirectUri = "http://127.0.0.1:43123/callback";
    const server = createOAuthTestServer({
      signingKeySeed: "tiny-oauth-test-server:empty-scopes",
      staticClients: [{ clientId: "client", redirectUris: [redirectUri], scopes: [] }],
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const response = await nodeFetch(
      `${server.issuer}/authorize?client_id=client&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&response_type=code&code_challenge=${encodeURIComponent(createPkceChallenge(createValidVerifier("empty-scope-verifier")))}`
        + "&code_challenge_method=S256&resource=https%3A%2F%2Fresource.example.com%2Fmcp&scope=mcp.admin",
      { redirect: "manual" }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_scope" });
  });

  it("rejects a concurrent second listener instead of orphaning a bound server", async () => {
    const server = createOAuthTestServer({ signingKeySeed: "tiny-oauth-test-server:concurrent" });
    const results = await Promise.allSettled([
      server.listen({ port: 0, hostname: "127.0.0.1" }),
      server.listen({ port: 0, hostname: "127.0.0.1" })
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof server.listen>>> =>
        result.status === "fulfilled"
    );

    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    if (fulfilled[0]) {
      cleanups.add(fulfilled[0].value.close);
    }
  });

  it("serves RFC 8414 metadata only from the path-based well-known location for pathful issuers", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const issuerPort = await reservePort("127.0.0.1");
      const issuer = `http://127.0.0.1:${issuerPort}/oauth`;
      const server = createOAuthTestServer({
        issuer,
        signingKeySeed: "tiny-oauth-test-server:pathful-issuer",
      });

      try {
        const handle = await server.listen({ hostname: "127.0.0.1", port: issuerPort });
        cleanups.add(handle.close);

        const pathResponse = await nodeFetch(
          `http://127.0.0.1:${issuerPort}/.well-known/oauth-authorization-server/oauth`
        );
        const rootResponse = await nodeFetch(
          `http://127.0.0.1:${issuerPort}/.well-known/oauth-authorization-server`
        );

        expect(pathResponse.status).toBe(200);
        expect(rootResponse.status).toBe(404);
        return;
      } catch (error) {
        if (!hasOwnErrorCode(error, "EADDRINUSE") || attempt === 4) {
          throw error;
        }
      }
    }
  });

  it("does not expose root authorization aliases for a pathful issuer", async () => {
    const issuerPort = await reservePort("127.0.0.1");
    const server = createOAuthTestServer({
      issuer: `http://127.0.0.1:${issuerPort}/oauth`,
      signingKeySeed: "tiny-oauth-test-server:pathful-routes",
      defaultAuthorization: { autoApprove: true },
      requireDcr: false
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: issuerPort });
    cleanups.add(handle.close);

    const response = await nodeFetch(
      `http://127.0.0.1:${issuerPort}/authorize?client_id=client&redirect_uri=${encodeURIComponent("http://127.0.0.1:43123/callback")}`
        + "&response_type=code&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12&code_challenge_method=S256&resource=https%3A%2F%2Fresource.example.com%2Fmcp",
      { redirect: "manual" }
    );

    expect(response.status).toBe(404);
  });

  it("preserves query parameters in configured issuer identifiers", () => {
    const server = createOAuthTestServer({ issuer: "http://127.0.0.1?tenant=demo" });

    expect(server.issuer).toBe("http://127.0.0.1/?tenant=demo");
  });

  it("round-trips register, authorize, and token into a verifiable JWT", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43123/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = createValidVerifier("correct-horse-battery-staple");
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
    expect(authorization.iss).toBe(server.issuer);

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

  it("validates dynamic client registration requests and returns a canonical public-client response", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43140/callback";
    const response = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "poe-code test",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "mcp.read mcp.write",
        software_id: "poe-code",
        software_version: "1.0.0",
      }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json() as Record<string, unknown>;

    expect(payload).toMatchObject({
      client_id: expect.stringMatching(/^client_\d{6}$/),
      client_name: "poe-code test",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp.read mcp.write",
      software_id: "poe-code",
      software_version: "1.0.0",
    });
    expect(typeof payload.client_id_issued_at).toBe("number");
    expect(payload.client_secret).toBeUndefined();
    expect(payload.client_secret_expires_at).toBeUndefined();
  });

  it("rejects unsupported token_endpoint_auth_method values during registration", async () => {
    const { server } = await listenServer();
    const response = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "poe-code test",
        redirect_uris: ["http://127.0.0.1:43141/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        scope: "mcp.read",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
      error_description: "token_endpoint_auth_method client_secret_basic is not supported",
    });
  });

  it("does not allow refresh grants omitted during registration", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43145/callback";
    const resource = "https://resource.example.com/no-refresh";
    const registration = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code"],
        response_types: ["code"]
      })
    });
    const clientId = ((await registration.json()) as { client_id: string }).client_id;
    const codeVerifier = createValidVerifier("no-refresh-verifier");
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier)
    });
    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource
    });
    const payload = (await tokenResponse.json()) as Record<string, unknown>;

    expect(payload.refresh_token).toBeUndefined();
  });

  it("rejects malformed registration metadata instead of silently defaulting it", async () => {
    const { server } = await listenServer();
    for (const body of [
      { redirect_uris: ["http://127.0.0.1:43141/callback"], scope: ["mcp.read"] },
      { redirect_uris: ["http://127.0.0.1:43141/callback"], token_endpoint_auth_method: {} }
    ]) {
      const response = await nodeFetch(`${server.issuer}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    }
  });

  it("rejects inherited dynamic registration metadata fields", async () => {
    const { server } = await listenServer();

    await withObjectPrototypeProperties(
      {
        redirect_uris: ["http://127.0.0.1:43141/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      },
      async () => {
        const response = await nodeFetch(`${server.issuer}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: "invalid_redirect_uri"
        });
      }
    );
  });

  it("rejects dynamic registrations with non-loopback redirects", async () => {
    const { server } = await listenServer();
    const response = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://attacker.example/callback"] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("accepts a valid PKCE verifier that uses the full RFC 7636 unreserved alphabet", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43130/callback";
    const resource = "https://resource.example.com/unreserved";
    const codeVerifier =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
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
      codeChallenge: createPkceChallenge(createValidVerifier("expected-verifier")),
    });

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier: createValidVerifier("wrong-verifier"),
      redirectUri,
      resource,
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rejects a too-short PKCE verifier even when the challenge matches", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43131/callback";
    const resource = "https://resource.example.com/short-verifier";
    const codeVerifier = "short";
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
    const payload = (await tokenResponse.json()) as {
      error: string;
      error_description?: string;
    };

    expect(tokenResponse.status).toBe(400);
    expect(payload.error).toBe("invalid_grant");
    expect(payload.error_description).not.toContain(codeVerifier);
  });

  it("rejects a PKCE verifier whose alphabet is outside RFC 7636 unreserved characters", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43132/callback";
    const resource = "https://resource.example.com/bad-alphabet";
    const codeVerifier = `${"A".repeat(42)}!`;
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
    const payload = (await tokenResponse.json()) as {
      error: string;
      error_description?: string;
    };

    expect(tokenResponse.status).toBe(400);
    expect(payload.error).toBe("invalid_grant");
    expect(payload.error_description).not.toContain(codeVerifier);
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
      codeChallenge: createPkceChallenge(createValidVerifier("matching-verifier")),
    });

    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier: createValidVerifier("matching-verifier"),
      redirectUri,
      resource: "https://resource.example.com/b",
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rejects a fragment-bearing resource indicator", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43136/callback";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });

    const authorizeResponse = await nodeFetch(
      new URL(
        `/authorize?client_id=${encodeURIComponent(clientId)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + "&response_type=code"
        + `&code_challenge=${encodeURIComponent(createPkceChallenge(createValidVerifier("fragment-verifier")))}`
        + "&code_challenge_method=S256"
        + `&resource=${encodeURIComponent("https://resource.example.com/mcp#fragment")}`
        + "&auto_approve=1",
        server.issuer
      ),
      {
        redirect: "manual",
      }
    );

    expect(authorizeResponse.status).toBe(400);
    await expect(authorizeResponse.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "resource must not include a fragment",
    });
  });

  it("rejects code_challenge_method=plain", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43133/callback";
    const resource = "https://resource.example.com/plain";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });
    const response = await nodeFetch(
      new URL(
        `/authorize?client_id=${encodeURIComponent(clientId)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + "&response_type=code"
        + "&code_challenge=plain-verifier"
        + "&code_challenge_method=plain"
        + `&resource=${encodeURIComponent(resource)}`
        + "&auto_approve=1",
        server.issuer
      ),
      {
        redirect: "manual",
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
  });

  it("rejects malformed S256 challenges before issuing an authorization code", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43146/callback";
    const clientId = await registerClient({ baseUrl: server.issuer, redirectUris: [redirectUri] });
    const response = await nodeFetch(
      `${server.issuer}/authorize?client_id=${encodeURIComponent(clientId)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
        + "&code_challenge=not-a-sha256-code-challenge&code_challenge_method=S256"
        + "&resource=https%3A%2F%2Fresource.example.com%2Fmcp&auto_approve=1",
      { redirect: "manual" }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("does not let authorization query parameters bypass disabled consent", async () => {
    const redirectUri = "http://127.0.0.1:43147/callback";
    const server = createOAuthTestServer({
      signingKeySeed: "tiny-oauth-test-server:consent",
      staticClients: [{ clientId: "client", redirectUris: [redirectUri] }],
      defaultAuthorization: { autoApprove: false }
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);
    const response = await nodeFetch(
      `${server.issuer}/authorize?client_id=client&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&response_type=code&code_challenge=${encodeURIComponent(createPkceChallenge(createValidVerifier("consent-verifier")))}`
        + "&code_challenge_method=S256&resource=https%3A%2F%2Fresource.example.com%2Fmcp&auto_approve=1",
      { redirect: "manual" }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Authorize test client");
  });

  it("allows retrying shutdown after a transient close failure", async () => {
    const originalClose = http.Server.prototype.close;
    const close = vi.spyOn(http.Server.prototype, "close");
    close.mockImplementationOnce(function (callback?: (error?: Error) => void) {
      callback?.(new Error("close temporarily failed"));
      return this;
    });
    close.mockImplementation(function (callback?: (error?: Error) => void) {
      return originalClose.call(this, callback as never);
    });
    const server = createOAuthTestServer({ signingKeySeed: "tiny-oauth-test-server:close-retry" });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

    await expect(handle.close()).rejects.toThrow("close temporarily failed");
    await expect(handle.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });


  it("rotates refresh tokens and issues a new access token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43126/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = createValidVerifier("refresh-flow-verifier");
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

  it("rejects a refresh token at its exact expiration instant", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43142/callback";
    const resource = "https://resource.example.com/refresh-expired";
    const codeVerifier = createValidVerifier("refresh-expired-verifier");
    const clientId = await registerClient({ baseUrl: server.issuer, redirectUris: [redirectUri] });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier)
    });
    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource
    });
    const payload = (await tokenResponse.json()) as { refresh_token: string };

    now += 3_600_000;
    const refreshResponse = await refreshAccessToken({
      baseUrl: server.issuer,
      clientId,
      refreshToken: payload.refresh_token,
      resource
    });

    expect(refreshResponse.status).toBe(400);
    await expect(refreshResponse.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects refresh-token reuse after rotation invalidates the old token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43135/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = createValidVerifier("refresh-reuse-verifier");
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
      refresh_token: string;
    };

    const rotatedResponse = await refreshAccessToken({
      baseUrl: server.issuer,
      clientId,
      refreshToken: firstPayload.refresh_token,
      resource,
    });
    expect(rotatedResponse.status).toBe(200);

    const reuseResponse = await refreshAccessToken({
      baseUrl: server.issuer,
      clientId,
      refreshToken: firstPayload.refresh_token,
      resource,
    });

    expect(reuseResponse.status).toBe(400);
    await expect(reuseResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
      error_description: "refresh token is invalid",
    });
  });

  it("redacts PKCE verifiers from the request log", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43134/callback";
    const resource = "https://resource.example.com/redaction";
    const codeVerifier = "redaction-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123";
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

    await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });

    const tokenRequest = server.requestLog.find(
      (request) =>
        request.method === "POST"
        && request.url.endsWith("/token")
        && (request.body?.includes("grant_type=authorization_code") ?? false)
    );
    expect(tokenRequest?.body).toBeTruthy();
    expect(tokenRequest?.body).not.toContain(codeVerifier);
    expect(tokenRequest?.body).toContain("code_verifier=");
  });

  it("records authorization server traffic for programmatic assertions", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43129/callback";
    const resource = "https://resource.example.com/request-log";
    const codeVerifier = createValidVerifier("request-log-verifier");
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
      scope: "mcp.read",
    });
    const tokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });
    const tokenPayload = (await tokenResponse.json()) as {
      refresh_token: string;
    };

    await refreshAccessToken({
      baseUrl: server.issuer,
      clientId,
      refreshToken: tokenPayload.refresh_token,
      resource,
    });

    const requestLog = server.requestLog;
    expect(
      requestLog.filter((request) => request.method === "POST" && request.url.endsWith("/register"))
    ).toHaveLength(1);
    expect(
      requestLog.filter((request) => request.method === "GET" && request.url.includes("/authorize?"))
    ).toHaveLength(1);
    expect(
      requestLog.filter((request) => {
        if (request.method !== "POST" || !request.url.endsWith("/token")) {
          return false;
        }

        return new URLSearchParams(request.body ?? "").get("grant_type") === "authorization_code";
      })
    ).toHaveLength(1);
    expect(
      requestLog.filter((request) => {
        if (request.method !== "POST" || !request.url.endsWith("/token")) {
          return false;
        }

        return new URLSearchParams(request.body ?? "").get("grant_type") === "refresh_token";
      })
    ).toHaveLength(1);
    const refreshRequest = requestLog.find((request) =>
      request.body?.includes("grant_type=refresh_token")
    );
    expect(refreshRequest?.body).not.toContain(tokenPayload.refresh_token);
    expect(refreshRequest?.body).toContain("refresh_token=%5Bredacted%5D");
  });

  it("rejects authorization codes after the first successful exchange", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43127/callback";
    const resource = "https://resource.example.com/mcp";
    const codeVerifier = createValidVerifier("single-use-code-verifier");
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

  it("rejects authorization codes at their exact expiration instant", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43143/callback";
    const resource = "https://resource.example.com/code-expired";
    const codeVerifier = createValidVerifier("code-expired-verifier");
    const clientId = await registerClient({ baseUrl: server.issuer, redirectUris: [redirectUri] });
    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier)
    });

    now += 300_000;
    const response = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: authorization.code,
      codeVerifier,
      redirectUri,
      resource
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects re-used PKCE verifiers across two token requests", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43135/callback";
    const resource = "https://resource.example.com/reused-verifier";
    const codeVerifier = "reused-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [redirectUri],
    });

    const firstAuthorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
    });
    const firstTokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: firstAuthorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });
    expect(firstTokenResponse.status).toBe(200);

    const secondAuthorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri,
      resource,
      codeChallenge: createPkceChallenge(codeVerifier),
    });
    const secondTokenResponse = await exchangeAuthorizationCode({
      baseUrl: server.issuer,
      clientId,
      code: secondAuthorization.code,
      codeVerifier,
      redirectUri,
      resource,
    });
    const secondPayload = (await secondTokenResponse.json()) as {
      error: string;
      error_description?: string;
    };

    expect(secondTokenResponse.status).toBe(400);
    expect(secondPayload.error).toBe("invalid_grant");
    expect(secondPayload.error_description).not.toContain(codeVerifier);
  });

  it("rejects localhost redirect URIs during authorization", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://localhost:43136/callback";
    const response = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_redirect_uri",
    });
  });

  it("rejects https redirect URIs in the public-client loopback flow", async () => {
    const { server } = await listenServer();
    const redirectUri = "https://127.0.0.1/callback";
    const response = await nodeFetch(`${server.issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_redirect_uri",
    });
  });

  it("rejects hostname values merely prefixed with the loopback octet", async () => {
    const server = createOAuthTestServer({
      signingKeySeed: "tiny-oauth-test-server:hostname-prefix",
      requireDcr: false,
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);
    const response = await nodeFetch(
      `${server.issuer}/authorize?client_id=client&redirect_uri=${encodeURIComponent("http://127.attacker.example.test/callback")}`
        + "&response_type=code&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12"
        + "&code_challenge_method=S256&resource=https%3A%2F%2Fresource.example.com%2Fmcp",
      { redirect: "manual" }
    );

    expect(response.status).toBe(400);
  });

  it("allows port-only variance against a registered loopback redirect URI", async () => {
    const { server } = await listenServer();
    const registeredRedirectUri = "http://127.0.0.1/callback";
    const requestedRedirectUri = "http://127.0.0.1:43137/callback";
    const resource = "https://resource.example.com/port-variance";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: [registeredRedirectUri],
    });

    const authorization = await authorize({
      baseUrl: server.issuer,
      clientId,
      redirectUri: requestedRedirectUri,
      resource,
      codeChallenge: createPkceChallenge("port-variance-verifier-ABCDEFGHIJKLMNOPQRSTUVWX"),
    });

    expect(authorization.code).toBeTruthy();
  });

  it("rejects path mismatches against a registered loopback redirect URI", async () => {
    const { server } = await listenServer();
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: ["http://127.0.0.1/callback"],
    });
    const response = await nodeFetch(
      new URL(
        `/authorize?client_id=${encodeURIComponent(clientId)}`
        + `&redirect_uri=${encodeURIComponent("http://127.0.0.1:43138/other")}`
        + "&response_type=code"
        + `&code_challenge=${encodeURIComponent(createPkceChallenge("path-mismatch-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123"))}`
        + "&code_challenge_method=S256"
        + `&resource=${encodeURIComponent("https://resource.example.com/path-mismatch")}`
        + "&auto_approve=1",
        server.issuer
      ),
      {
        redirect: "manual",
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
  });

  it("rejects redirect_uri path mismatches between authorize and token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43139/callback";
    const resource = "https://resource.example.com/token-path-mismatch";
    const codeVerifier = "token-path-mismatch-verifier-ABCDEFGHIJKLMNOPQRSTUV";
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
      redirectUri: `${redirectUri}/`,
      resource,
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rejects redirect_uri port-only mismatches between authorize and token", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://127.0.0.1:43140/callback";
    const resource = "https://resource.example.com/token-port-mismatch";
    const codeVerifier = "token-port-mismatch-verifier-ABCDEFGHIJKLMNOPQRSTUV";
    const clientId = await registerClient({
      baseUrl: server.issuer,
      redirectUris: ["http://127.0.0.1/callback"],
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
      redirectUri: "http://127.0.0.1:43141/callback",
      resource,
    });

    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({
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

  it("rejects direct tokens with a non-positive ttl", async () => {
    const { server } = await listenServer();

    await expect(
      server.issueTokenFor({
        clientId: "direct-client",
        resource: "https://resource.example.com/direct",
        scopes: [],
        ttlSeconds: -60
      })
    ).rejects.toThrow("ttlSeconds must be a positive integer");
  });

  it("rejects malformed HTTP direct-token fields", async () => {
    const { server } = await listenServer();
    for (const body of [
      { client_id: "client", resource: "https://resource.example.com/direct", scopes: {} },
      { client_id: "client", resource: "https://resource.example.com/direct", ttl_seconds: "never" }
    ]) {
      const response = await nodeFetch(`${server.issuer}/testing/issue-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
    }
  });

  it("rejects inherited HTTP direct-token fields", async () => {
    const { server } = await listenServer();

    await withObjectPrototypeProperties(
      {
        client_id: "direct-client",
        resource: "https://resource.example.com/direct",
        scopes: ["mcp.read"],
        ttl_seconds: 120
      },
      async () => {
        const response = await nodeFetch(`${server.issuer}/testing/issue-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: "invalid_request",
          error_description: "client_id is required"
        });
      }
    );
  });

  it("accepts IPv6 loopback redirect URIs", async () => {
    const { server } = await listenServer();
    const redirectUri = "http://[::1]:43128/callback";
    const resource = "https://resource.example.com/ipv6";
    const codeVerifier = createValidVerifier("ipv6-loopback-verifier");
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
