import { describe, it, expect, vi } from "vitest";
import http from "node:http";
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
  boundPort: number;
} {
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;
  const boundPort = 54321;

  const server = {
    on: vi.fn((event: string, handler: any) => {
      if (event === "request") {
        requestHandler = handler;
      }
      return server;
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
    const res = {
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as http.ServerResponse;
    requestHandler(req, res);
  };

  return { server, simulateCallback, boundPort };
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
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${boundPort}/callback`
    );
  });

  it("exchanges code for API key via token endpoint", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-api-key-123", 7200));

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=auth-code-abc");
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
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=some-code");
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
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=code");
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

  it("throws when token endpoint returns non-200", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=bad-code");
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow();
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
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=code");
      }),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    await expect(authorization.waitForResult()).rejects.toThrow("api_key");
  });

  it("uses PKCE S256 challenge method", async () => {
    const { server, simulateCallback } = createMockServer();
    const openBrowser = vi.fn(async (_url: string) => {
      simulateCallback("/callback?code=test-code");
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

  it("accepts authorization code pasted as redirect URL", async () => {
    const { server } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-pasted-key"));

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        // Browser does NOT redirect — user pastes URL instead
      }),
      readLine: vi.fn(async () => "http://127.0.0.1:54321/callback?code=pasted-code"),
      createServer: () => server,
      fetch: fetchMock as any
    });

    const client = createOAuthClient(config);
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();

    expect(result.apiKey).toBe("sk-pasted-key");
    const body = new URLSearchParams(fetchMock.mock.calls[0]![1].body);
    expect(body.get("code")).toBe("pasted-code");
  });

  it("localhost callback wins the race when it arrives first", async () => {
    const { server, simulateCallback } = createMockServer();
    const fetchMock = vi.fn(async () => createTokenResponse("sk-callback-key"));

    const config = createTestConfig({
      openBrowser: vi.fn(async () => {
        simulateCallback("/callback?code=callback-code");
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
});
