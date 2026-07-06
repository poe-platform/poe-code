import { createSecretKey } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJwksTokenVerifier } from "./index.js";

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

describe("createJwksTokenVerifier", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function createOAuthFixture() {
    const issuer = "https://auth.example.com";
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);

    return {
      issuer,
      async fetch(input: string | URL) {
        const url = new URL(String(input));
        if (url.toString() !== `${issuer}/.well-known/jwks.json`) {
          return new Response("not found", { status: 404 });
        }

        return new Response(
          JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      },
      async issueTokenFor(input: {
        clientId: string;
        resource: string;
        scopes: readonly string[];
        ttlSeconds?: number;
      }) {
        const now = Math.floor(Date.now() / 1_000);
        return new SignJWT({
          client_id: input.clientId,
          scope: input.scopes.join(" ")
        })
          .setProtectedHeader({
            alg: "ES256",
            typ: "JWT"
          })
          .setIssuer(issuer)
          .setAudience(input.resource)
          .setSubject(input.clientId)
          .setIssuedAt(now)
          .setExpirationTime(now + (input.ttlSeconds ?? 60))
          .sign(privateKey);
      }
    };
  }

  it("verifies a JWT against the published JWKS", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      token,
      issuer: oauth.issuer,
      audience: ["https://resource.example.com/mcp"],
      scopes: ["mcp.read"],
      clientId: "demo-client"
    });
  });

  it("caches the JWKS between token verifications", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    let fetchCount = 0;
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(privateKey);
    const input = {
      token,
      resource: "https://resource.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: ["mcp.read"]
    };

    await verifier.verify(input);
    await verifier.verify(input);

    expect(fetchCount).toBe(1);
  });

  it("rejects tokens whose audience does not match the protected resource", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/other",
      scopes: ["mcp.read"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: []
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "audience mismatch"
    });
  });

  it("accepts a configured resource URI that is canonically equivalent to the token audience", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "HTTPS://RESOURCE.EXAMPLE.COM:443/mcp#ignored",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      audience: ["https://resource.example.com/mcp"]
    });
  });

  it("accepts tokens when one of multiple audiences matches", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience(["https://resource.example.com/other", "https://resource.example.com/mcp"])
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      audience: ["https://resource.example.com/mcp"]
    });
  });

  it("rejects tokens that do not satisfy the required scopes", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.write"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "insufficient_scope",
      errorDescription: "insufficient scope",
      scope: ["mcp.read"]
    });
  });

  it("ignores inherited token scope claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
    });
    const token = await new SignJWT({
      client_id: "demo-client"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(privateKey);

    await withObjectPrototypeProperties(
      {
        scope: "mcp.read"
      },
      async () => {
        await expect(
          verifier.verify({
            token,
            resource: "https://resource.example.com/mcp",
            authorizationServers: ["https://auth.example.com"],
            requiredScopes: ["mcp.read"]
          })
        ).rejects.toMatchObject({
          error: "insufficient_scope",
          errorDescription: "insufficient scope",
          scope: ["mcp.read"]
        });
      }
    );
  });

  it("rejects JWKS documents with inherited key sets", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(privateKey);

    await withObjectPrototypeProperties(
      {
        keys: [{ ...publicJwk, alg: "ES256", use: "sig" }]
      },
      async () => {
        await expect(
          verifier.verify({
            token,
            resource: "https://resource.example.com/mcp",
            authorizationServers: ["https://auth.example.com"],
            requiredScopes: ["mcp.read"]
          })
        ).rejects.toMatchObject({
          error: "temporarily_unavailable",
          errorDescription: "token verification temporarily unavailable"
        });
      }
    );
  });

  it("rejects tokens missing any required scope", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read", "mcp.write"]
      })
    ).rejects.toMatchObject({
      error: "insufficient_scope",
      errorDescription: "insufficient scope",
      scope: ["mcp.read", "mcp.write"]
    });
  });

  it("tries every matching kid in the JWKS until one verifies the signature", async () => {
    const { publicKey: wrongPublicKey } = await generateKeyPair("ES256");
    const { privateKey: correctPrivateKey, publicKey: correctPublicKey } =
      await generateKeyPair("ES256");
    const [wrongPublicJwk, correctPublicJwk] = await Promise.all([
      exportJWK(wrongPublicKey),
      exportJWK(correctPublicKey)
    ]);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(
          JSON.stringify({
            keys: [
              { ...wrongPublicJwk, alg: "ES256", use: "sig", kid: "shared-kid" },
              { ...correctPublicJwk, alg: "ES256", use: "sig", kid: "shared-kid" }
            ]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "ES256",
        kid: "shared-kid",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(correctPrivateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      audience: ["https://resource.example.com/mcp"],
      clientId: "demo-client",
      scopes: ["mcp.read"]
    });
  });

  it("rejects alg=none tokens", async () => {
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => {
        throw new Error("JWKS should not be fetched for alg=none");
      }
    });
    const token = createUnsecuredJwt({
      aud: "https://resource.example.com/mcp",
      client_id: "demo-client",
      exp: Math.floor(Date.now() / 1_000) + 120,
      iss: "https://auth.example.com",
      scope: "mcp.read",
      sub: "demo-client"
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "unsupported token algorithm"
    });
  });

  it("rejects HS* tokens when no shared secret is configured, even if the allow-list includes them", async () => {
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      allowedAlgorithms: ["HS256"],
      fetch: async () => {
        throw new Error("JWKS should not be fetched for unsupported HS* verification");
      }
    });
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(Math.floor(Date.now() / 1_000))
      .setExpirationTime("2m")
      .sign(createSecretKey(Buffer.from("mcp-oauth-shared-secret")));

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "unsupported token algorithm"
    });
  });

  it("requires an exact issuer match against the configured authorization server URL", async () => {
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"]
    });

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [`${oauth.issuer}/`],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "issuer mismatch"
    });
  });

  it("accepts tokens inside the configured expiration clock-skew window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      clockSkewSeconds: 30,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"],
      ttlSeconds: 1
    });
    vi.setSystemTime(new Date("2026-05-28T10:00:21.000Z"));

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).resolves.toMatchObject({
      clientId: "demo-client",
      scopes: ["mcp.read"]
    });
  });

  it("rejects tokens outside the configured expiration clock-skew window with token expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
    const oauth = await createOAuthFixture();
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      clockSkewSeconds: 30,
      fetch: oauth.fetch
    });
    const token = await oauth.issueTokenFor({
      clientId: "demo-client",
      resource: "https://resource.example.com/mcp",
      scopes: ["mcp.read"],
      ttlSeconds: 1
    });
    vi.setSystemTime(new Date("2026-05-28T10:00:32.000Z"));

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "token expired"
    });
  });

  it("rejects tokens whose nbf is beyond the configured clock-skew window", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      clockSkewSeconds: 30,
      fetch: async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: "ES256", use: "sig" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
    });
    const now = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({
      client_id: "demo-client",
      scope: "mcp.read"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "JWT"
      })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setSubject("demo-client")
      .setIssuedAt(now)
      .setNotBefore(now + 90)
      .setExpirationTime(now + 180)
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "token not active yet"
    });
  });

  it("rejects tokens with critical headers the verifier does not understand", async () => {
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => {
        throw new Error("JWKS should not be fetched for unsupported critical headers");
      }
    });
    const now = Math.floor(Date.now() / 1_000);
    const token = [
      encodeBase64Url({
        alg: "ES256",
        typ: "JWT",
        crit: ["future"],
        future: true
      }),
      encodeBase64Url({
        aud: "https://resource.example.com/mcp",
        client_id: "demo-client",
        exp: now + 120,
        iat: now,
        iss: "https://auth.example.com",
        scope: "mcp.read",
        sub: "demo-client"
      }),
      "invalid-signature"
    ].join(".");

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "unsupported critical token claims"
    });
  });

  it("rejects tokens without an expiry", async () => {
    const oauth = await createOAuthFixture();
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
      fetch: async () => new Response(JSON.stringify({ keys: [publicJwk] }))
    });
    const token = await new SignJWT({ scope: "mcp.read" })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer(oauth.issuer)
      .setAudience("https://resource.example.com/mcp")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: [oauth.issuer],
        requiredScopes: ["mcp.read"]
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "token missing expiry"
    });
  });

  it("times out JWKS fetches and reports the IdP outage", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      jwksFetchTimeoutMs: 5,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(init.signal?.reason);
            },
            { once: true }
          );
        })
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setExpirationTime("2m")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: []
      })
    ).rejects.toMatchObject({
      error: "temporarily_unavailable",
      errorDescription: "token verification temporarily unavailable"
    });
  });

  it.each([
    [
      "network errors",
      async () => {
        throw new Error("connection reset");
      }
    ],
    ["non-success responses", async () => new Response("unavailable", { status: 503 })],
    ["malformed documents", async () => new Response(JSON.stringify({ nope: [] }))],
    ["malformed key sets", async () => new Response(JSON.stringify({ keys: [null] }))]
  ])("reports %s loading JWKS as temporarily unavailable", async (_name, fetchImplementation) => {
    const { privateKey } = await generateKeyPair("ES256");
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: fetchImplementation
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setExpirationTime("2m")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: []
      })
    ).rejects.toMatchObject({
      error: "temporarily_unavailable"
    });
  });

  it("reports malformed JWKS key material as temporarily unavailable", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () =>
        new Response(
          JSON.stringify({
            keys: [
              {
                alg: "ES256",
                crv: "P-256",
                kid: "malformed",
                kty: "EC",
                x: "invalid",
                y: "invalid"
              }
            ]
          })
        )
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "malformed", typ: "JWT" })
      .setIssuer("https://auth.example.com")
      .setAudience("https://resource.example.com/mcp")
      .setExpirationTime("2m")
      .sign(privateKey);

    await expect(
      verifier.verify({
        token,
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: []
      })
    ).rejects.toMatchObject({
      error: "temporarily_unavailable"
    });
  });

  it("refetches JWKS once when a rotated kid is not cached", async () => {
    const oldKeys = await generateKeyPair("ES256");
    const newKeys = await generateKeyPair("ES256");
    const oldJwk = { ...(await exportJWK(oldKeys.publicKey)), kid: "old" };
    const newJwk = { ...(await exportJWK(newKeys.publicKey)), kid: "new" };
    let fetchCount = 0;
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: fetchCount === 1 ? [oldJwk] : [newJwk] }));
      }
    });
    const issue = (kid: string, privateKey: CryptoKey) =>
      new SignJWT({ scope: "mcp.read" })
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setIssuer("https://auth.example.com")
        .setAudience("https://resource.example.com/mcp")
        .setExpirationTime("2m")
        .sign(privateKey);
    const input = {
      resource: "https://resource.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: ["mcp.read"]
    };

    await verifier.verify({ ...input, token: await issue("old", oldKeys.privateKey) });
    await expect(
      verifier.verify({
        ...input,
        token: await issue("new", newKeys.privateKey)
      })
    ).resolves.toMatchObject({ scopes: ["mcp.read"] });
    expect(fetchCount).toBe(2);
  });

  it("shares a cache-busting JWKS refresh across concurrent requests", async () => {
    const oldKeys = await generateKeyPair("ES256");
    const newKeys = await generateKeyPair("ES256");
    const oldJwk = { ...(await exportJWK(oldKeys.publicKey)), kid: "old" };
    const newJwk = { ...(await exportJWK(newKeys.publicKey)), kid: "new" };
    let fetchCount = 0;
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: fetchCount === 1 ? [oldJwk] : [newJwk] }));
      }
    });
    const issue = (kid: string, privateKey: CryptoKey) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setIssuer("https://auth.example.com")
        .setAudience("https://resource.example.com/mcp")
        .setExpirationTime("2m")
        .sign(privateKey);
    const input = {
      resource: "https://resource.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: []
    };

    await verifier.verify({ ...input, token: await issue("old", oldKeys.privateKey) });
    const rotatedToken = await issue("new", newKeys.privateKey);

    await expect(
      Promise.all([
        verifier.verify({ ...input, token: rotatedToken }),
        verifier.verify({ ...input, token: rotatedToken })
      ])
    ).resolves.toHaveLength(2);
    expect(fetchCount).toBe(2);
  });

  it("rate-limits cache-busting JWKS refreshes", async () => {
    const cachedKeys = await generateKeyPair("ES256");
    const unknownKeys = await generateKeyPair("ES256");
    const cachedJwk = { ...(await exportJWK(cachedKeys.publicKey)), kid: "cached" };
    let fetchCount = 0;
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      jwksRefreshCooldownMs: 30_000,
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: [cachedJwk] }));
      }
    });
    const issue = (kid: string, privateKey: CryptoKey) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setIssuer("https://auth.example.com")
        .setAudience("https://resource.example.com/mcp")
        .setExpirationTime("2m")
        .sign(privateKey);
    const input = {
      resource: "https://resource.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: []
    };

    await verifier.verify({ ...input, token: await issue("cached", cachedKeys.privateKey) });
    const unknownToken = await issue("unknown", unknownKeys.privateKey);
    await expect(verifier.verify({ ...input, token: unknownToken })).rejects.toMatchObject({
      error: "invalid_token"
    });
    await expect(verifier.verify({ ...input, token: unknownToken })).rejects.toMatchObject({
      error: "invalid_token"
    });
    expect(fetchCount).toBe(2);
  });

  it("rejects insecure remote JWKS URLs unless explicitly allowed", () => {
    expect(() =>
      createJwksTokenVerifier({
        jwksUrl: "http://auth.example.com/.well-known/jwks.json"
      })
    ).toThrow("jwksUrl must use HTTPS for non-loopback hosts");
    expect(() =>
      createJwksTokenVerifier({
        jwksUrl: "http://auth.example.com/.well-known/jwks.json",
        allowInsecureJwks: true
      })
    ).not.toThrow();
    expect(() =>
      createJwksTokenVerifier({
        jwksUrl: "http://127.0.0.1/.well-known/jwks.json"
      })
    ).not.toThrow();
  });

  it("optionally requires RFC 9068 access-token typ", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => new Response(JSON.stringify({ keys: [publicJwk] })),
      requireAccessTokenType: true
    });
    const issue = (typ: string) =>
      new SignJWT({ scope: "mcp.read" })
        .setProtectedHeader({ alg: "ES256", typ })
        .setIssuer("https://auth.example.com")
        .setAudience("https://resource.example.com/mcp")
        .setExpirationTime("2m")
        .sign(privateKey);
    const input = {
      resource: "https://resource.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      requiredScopes: ["mcp.read"]
    };

    await expect(verifier.verify({ ...input, token: await issue("JWT") })).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "invalid access token type"
    });
    await expect(
      verifier.verify({ ...input, token: await issue("at+jwt") })
    ).resolves.toMatchObject({
      audience: ["https://resource.example.com/mcp"],
      scopes: ["mcp.read"]
    });
  });

  it("does not disclose unexpected JOSE error messages", async () => {
    const verifier = createJwksTokenVerifier({
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      fetch: async () => new Response(JSON.stringify({ keys: [] }))
    });

    await expect(
      verifier.verify({
        token: "not-a-jwt",
        resource: "https://resource.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        requiredScopes: []
      })
    ).rejects.toMatchObject({
      error: "invalid_token",
      errorDescription: "token verification failed"
    });
  });
});

function createUnsecuredJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url({
      alg: "none",
      typ: "JWT"
    }),
    encodeBase64Url(payload),
    ""
  ].join(".");
}

function encodeBase64Url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
