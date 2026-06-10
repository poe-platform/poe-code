import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import {
  createAuthorizationState,
  parseAuthorizationState,
} from "./authorization-state.js";
import { checkAuth } from "./check-auth.js";
import { createOAuthClient } from "./oauth-client.js";
import type { OAuthClientConfig } from "./oauth-client.js";

function createTestConfig(
  overrides: Partial<OAuthClientConfig> = {}
): OAuthClientConfig {
  return {
    clientId: "test-client-id",
    authorizationEndpoint: "https://poe.com/oauth/authorize",
    tokenEndpoint: "https://api.poe.com/token",
    openBrowser: vi.fn(async () => {}),
    createServer: vi.fn(),
    fetch: vi.fn(),
    ...overrides
  };
}

function createMockServer(): {
  server: http.Server;
  simulateCallback: (url: string) => void;
  captureResponseBody: () => string;
  boundPort: number;
} {
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;
  let errorHandler: ((error: Error) => void) | null = null;
  const boundPort = 54321;
  let lastResponseBody = "";

  const server = {
    on: vi.fn((event: string, handler: any) => {
      if (event === "request") {
        requestHandler = handler;
      }
      return server;
    }),
    once: vi.fn((event: string, handler: any) => {
      if (event === "error") {
        errorHandler = handler;
      }
      return server;
    }),
    off: vi.fn((event: string, handler: any) => {
      if (event === "error" && errorHandler === handler) {
        errorHandler = null;
      }
      return server;
    }),
    emit: vi.fn((event: string, error: Error) => {
      if (event === "error" && errorHandler !== null) {
        errorHandler(error);
      }
      return true;
    }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(() => callback());
      return server;
    }),
    close: vi.fn((callback?: () => void) => {
      if (callback) callback();
      return server;
    }),
    address: vi.fn(() => ({ port: boundPort }))
  } as unknown as http.Server;

  const simulateCallback = (url: string) => {
    if (!requestHandler) throw new Error("No request handler registered");
    const req = {
      url,
      method: "GET"
    } as http.IncomingMessage;
    const endFn = vi.fn((body: string) => { lastResponseBody = body; });
    const res = {
      writeHead: vi.fn(),
      end: endFn
    } as unknown as http.ServerResponse;
    requestHandler(req, res);
  };

  const captureResponseBody = () => lastResponseBody;

  return { server, simulateCallback, captureResponseBody, boundPort };
}

function createTokenResponse(apiKey: string, expiresIn?: number): Response {
  const body: Record<string, unknown> = { api_key: apiKey };
  if (expiresIn !== undefined) {
    body.api_key_expires_in = expiresIn;
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function createCallbackPath(authorizationUrl: string, code: string): string {
  const callback = new URL("http://127.0.0.1/callback");
  const state = new URL(authorizationUrl).searchParams.get("state");
  callback.searchParams.set("code", code);
  if (state !== null) {
    callback.searchParams.set("state", state);
  }
  return `${callback.pathname}${callback.search}`;
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

function encodeStatePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("checkAuth", () => {
  it("returns identity when API responds with valid data", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "user@example.com",
            current_point_balance: 1500
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toEqual({
      email: "user@example.com",
      balance: 1500
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.poe.com/usage/current_balance", {
      method: "GET",
      headers: {
        Authorization: "Bearer provided-key"
      }
    });
  });

  it("uses the provided baseUrl", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "custom@example.com",
            current_point_balance: 5
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await checkAuth({
      apiKey: "provided-key",
      baseUrl: "https://example.test",
      fetch: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/usage/current_balance",
      expect.any(Object)
    );
  });

  it("preserves a base URL query while targeting the balance endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      email: "custom@example.com",
      current_point_balance: 5
    }), { status: 200 }));

    await checkAuth({
      apiKey: "provided-key",
      baseUrl: "https://example.test?tenant=demo",
      fetch: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/usage/current_balance?tenant=demo",
      expect.any(Object)
    );
  });

  it("returns null balance when the response balance is null", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "user@example.com",
            current_point_balance: null
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toEqual({
      email: "user@example.com",
      balance: null
    });
  });

  it("returns identity with null email when API omits email", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            current_point_balance: 21082621
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toEqual({
      email: null,
      balance: 21082621
    });
  });

  it("returns null when a successful response is not an identity object", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));

    await expect(
      checkAuth({ apiKey: "provided-key", fetch: fetchMock as typeof fetch })
    ).resolves.toBeNull();
  });

  it("ignores inherited identity response fields", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

    await withObjectPrototypeProperties(
      {
        email: "polluted@example.com",
        current_point_balance: 42
      },
      async () => {
        await expect(
          checkAuth({ apiKey: "provided-key", fetch: fetchMock as typeof fetch })
        ).resolves.toBeNull();
      }
    );
  });

  it("returns null when a successful response contains a non-finite balance", async () => {
    const fetchMock = vi.fn(async () => new Response(
      '{"email":"user@example.com","current_point_balance":1e309}',
      { status: 200 }
    ));

    await expect(
      checkAuth({ apiKey: "provided-key", fetch: fetchMock as typeof fetch })
    ).resolves.toBeNull();
  });

  it.each([401, 403])("returns null when Poe rejects the key with HTTP %i", async (status) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "forbidden" }), {
          status,
          headers: { "content-type": "application/json" }
        })
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toBeNull();
  });

  it("returns null on network errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network failed");
    });

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toBeNull();
  });
});

describe("OAuthClient", () => {
  it("returns authorization URL with correct parameters", async () => {
    const { server, boundPort } = createMockServer();

    const config = createTestConfig({
      createServer: () => server
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();

    const url = new URL(authorization.authorizationUrl);
    expect(url.origin).toBe("https://poe.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("scope")).toBe("apikey:create");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${boundPort}/callback`
    );
  });

  it("exchanges code for API key via token endpoint", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-api-key-123", 7200));

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "auth-code-abc"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();

    expect(result.apiKey).toBe("sk-api-key-123");
    expect(result.expiresIn).toBe(7200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl.toString()).toBe("https://api.poe.com/token");
    expect(tokenInit.method).toBe("POST");

    const body = new URLSearchParams(tokenInit.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-abc");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("redirect_uri")).toContain("/callback");
  });

  it("returns null expiresIn when token response omits it", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-no-expiry"));

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "some-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();

    expect(result.apiKey).toBe("sk-no-expiry");
    expect(result.expiresIn).toBeNull();
  });

  it("closes the server after authorization completes", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await authorization.waitForResult();

    expect(server.close).toHaveBeenCalled();
  });

  it("throws when callback contains an error", async () => {
    const { server, simulateCallback } = createMockServer();

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?error=access_denied&error_description=User+denied");
      }),
      createServer: () => server,
      fetch: vi.fn() as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("access_denied");
  });

  it("throws user-friendly message when token endpoint returns error_description", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        error: "invalid_grant",
        error_description: "The provided authorization code is invalid or has expired."
      }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "bad-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow(
      "The provided authorization code is invalid or has expired."
    );
  });

  it("ignores inherited token endpoint error fields", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "bad-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    await withObjectPrototypeProperties(
      {
        error_description: "polluted description",
        error: "polluted_error"
      },
      async () => {
        const client = createOAuthClient(config);
        const authorization = await client.authorize();
        await expect(authorization.waitForResult()).rejects.toThrow(
          "Token exchange failed (400): {}"
        );
      }
    );
  });

  it("throws error code when token endpoint returns error without description", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "bad-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("invalid_grant");
  });

  it("throws when token response is missing api_key", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "not-an-api-key" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("api_key");
  });

  it("ignores inherited token response fields", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    await withObjectPrototypeProperties(
      {
        api_key: "sk-polluted",
        api_key_expires_in: 3600
      },
      async () => {
        const client = createOAuthClient(config);
        const authorization = await client.authorize();
        await expect(authorization.waitForResult()).rejects.toThrow("api_key");
      }
    );
  });

  it("throws when token response api_key contains only whitespace", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("   "));
    const client = createOAuthClient(createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => simulateCallback(createCallbackPath(authorizationUrl, "code"))),
      createServer: () => server,
      fetch: fetchMock as any
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("api_key");
  });

  it.each([-60, Infinity])("throws for invalid token expiration duration %s", async (expiresIn) => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key", expiresIn));
    const client = createOAuthClient(createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => simulateCallback(createCallbackPath(authorizationUrl, "code"))),
      createServer: () => server,
      fetch: fetchMock as any
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("api_key_expires_in");
  });

  it("reports malformed successful token JSON as token exchange failure", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => new Response("{", { status: 200 }));
    const client = createOAuthClient(createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => simulateCallback(createCallbackPath(authorizationUrl, "code"))),
      createServer: () => server,
      fetch: fetchMock as any
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("Token exchange failed");
  });

  it("uses PKCE S256 challenge method", async () => {
    const { server, simulateCallback } = createMockServer();
    const openBrowser = vi.fn(async (authorizationUrl: string) => {
      simulateCallback(createCallbackPath(authorizationUrl, "test-code"));
    });
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));

    const config = createTestConfig({
      openBrowser,
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await authorization.waitForResult();

    const authUrl = new URL(authorization.authorizationUrl);
    const challenge = authUrl.searchParams.get("code_challenge")!;
    const verifier = new URLSearchParams(fetchMock.mock.calls[0]![1].body).get(
      "code_verifier"
    )!;

    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("uses default endpoints when not specified", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-default-key"));

    const client = createOAuthClient({
      clientId: "test-client-id",
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "default-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const authorization = await client.authorize();

    const authUrl = new URL(authorization.authorizationUrl);
    expect(authUrl.origin).toBe("https://poe.com");
    expect(authUrl.pathname).toBe("/oauth/authorize");

    const result = await authorization.waitForResult();
    expect(result.apiKey).toBe("sk-default-key");

    const [tokenUrl] = fetchMock.mock.calls[0]!;
    expect(tokenUrl.toString()).toBe("https://api.poe.com/token");
  });

  it("allows overriding default endpoints", async () => {
    const { server } = createMockServer();

    const client = createOAuthClient({
      clientId: "test-client-id",
      authorizationEndpoint: "https://custom.example.com/auth",
      tokenEndpoint: "https://custom.example.com/token",
      createServer: () => server
    });

    const authorization = await client.authorize();

    const authUrl = new URL(authorization.authorizationUrl);
    expect(authUrl.origin).toBe("https://custom.example.com");
    expect(authUrl.pathname).toBe("/auth");
  });

  it("listens on 127.0.0.1 for security", async () => {
    const { server } = createMockServer();

    const config = createTestConfig({
      createServer: () => server
    });

    const client = createOAuthClient(config);
    await client.authorize();

    expect(server.listen).toHaveBeenCalledWith(
      0,
      "127.0.0.1",
      expect.any(Function)
    );
  });

  it("rejects authorization when the loopback listener cannot start", async () => {
    const { server } = createMockServer();
    server.listen = vi.fn(() => {
      queueMicrotask(() => server.emit("error", new Error("bind failed")));
      return server;
    }) as typeof server.listen;

    await expect(createOAuthClient(createTestConfig({
      createServer: () => server
    })).authorize()).rejects.toThrow("bind failed");
  });

  it("rejects callbacks without the authorization state", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));
    const client = createOAuthClient(createTestConfig({
      openBrowser: vi.fn(async () => simulateCallback("/callback?code=unsolicited")),
      createServer: () => server,
      fetch: fetchMock as any
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts authorization code pasted as redirect URL", async () => {
    const { server } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-pasted-key"));
    let authorizationUrl = "";

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        // Browser does NOT redirect — user pastes URL instead
      }),
      readLine: vi.fn(async () => {
        await Promise.resolve();
        return `http://127.0.0.1:54321${createCallbackPath(authorizationUrl, "pasted-code")}`;
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    authorizationUrl = authorization.authorizationUrl;
    const result = await authorization.waitForResult();

    expect(result.apiKey).toBe("sk-pasted-key");
    const body = new URLSearchParams(fetchMock.mock.calls[0]![1].body);
    expect(body.get("code")).toBe("pasted-code");
  });

  it("rejects when reading the pasted callback fails", async () => {
    const { server } = createMockServer();
    const client = createOAuthClient(createTestConfig({
      readLine: vi.fn(async () => { throw new Error("stdin closed"); }),
      createServer: () => server
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("stdin closed");
  }, 100);

  it("uses default landing page text", async () => {
    const { server, simulateCallback, captureResponseBody } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));

    const client = createOAuthClient({
      clientId: "test-client-id",
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "test-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const authorization = await client.authorize();
    await authorization.waitForResult();

    const html = captureResponseBody();
    expect(html).toContain("Connected to Poe");
    expect(html).toContain("You can close this tab");
  });

  it("uses custom landing page text", async () => {
    const { server, simulateCallback, captureResponseBody } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));

    const client = createOAuthClient({
      clientId: "test-client-id",
      landingPage: {
        title: "All set!",
        body: "Return to your IDE."
      },
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "test-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const authorization = await client.authorize();
    await authorization.waitForResult();

    const html = captureResponseBody();
    expect(html).toContain("All set!");
    expect(html).toContain("Return to your IDE.");
    expect(html).not.toContain("Connected to Poe");
  });

  it("escapes HTML in custom landing page text", async () => {
    const { server, simulateCallback, captureResponseBody } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));

    const client = createOAuthClient({
      clientId: "test-client-id",
      landingPage: {
        title: "<script>alert('xss')</script>",
        body: 'Some "quoted" & <special> text'
      },
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "test-code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const authorization = await client.authorize();
    await authorization.waitForResult();

    const html = captureResponseBody();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quoted&quot;");
  });

  it("localhost callback wins the race when it arrives first", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-callback-key"));

    const config = createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "callback-code"));
      }),
      readLine: vi.fn(() => new Promise(() => {})),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();

    expect(result.apiKey).toBe("sk-callback-key");
    const body = new URLSearchParams(fetchMock.mock.calls[0]![1].body);
    expect(body.get("code")).toBe("callback-code");
  });

  it("returns the settled authorization result for repeated waits", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-key"));
    const client = createOAuthClient(createTestConfig({
      openBrowser: vi.fn(async (authorizationUrl) => {
        simulateCallback(createCallbackPath(authorizationUrl, "code"));
      }),
      createServer: () => server,
      fetch: fetchMock as any
    }));

    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).resolves.toEqual({ apiKey: "sk-key", expiresIn: null });
    await expect(authorization.waitForResult()).resolves.toEqual({ apiKey: "sk-key", expiresIn: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 100);
});

describe("authorization state", () => {
  it("round-trips generated authorization state", () => {
    const state = createAuthorizationState({
      issuer: "https://poe.com",
      requireIssuer: false,
    });

    expect(parseAuthorizationState(state)).toEqual({
      issuer: "https://poe.com",
      requireIssuer: false,
    });
  });

  it("ignores inherited decoded authorization state fields", async () => {
    await withObjectPrototypeProperties(
      {
        v: 1,
        n: "polluted-nonce",
        i: "https://polluted.example.com",
        r: true,
      },
      async () => {
        expect(parseAuthorizationState(encodeStatePayload({}))).toBeNull();
      }
    );
  });
});
