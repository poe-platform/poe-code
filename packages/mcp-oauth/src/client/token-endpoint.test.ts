import { describe, expect, it } from "vitest";
import {
  OAuthError,
  exchangeAuthorizationCode,
  refreshAccessToken,
  readOAuthJsonObjectResponse
} from "./token-endpoint.js";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("token endpoint parsing", () => {
  it.each(["authorization_code", "refresh_token"])("requests JSON responses for %s content negotiation", async grantType => {
    const fetch = async (_url: string | URL, init?: RequestInit) => new Headers(init?.headers).get("Accept") === "application/json"
      ? jsonResponse({ access_token: "negotiated-access", token_type: "Bearer" })
      : new Response("<html>Choose a response format</html>", { headers: { "Content-Type": "text/html" } });
    const common = { tokenEndpoint: "https://auth.example.test/token", clientId: "client", resource: "https://resource.example.test/", fetch, now: () => 1000 };
    const result = grantType === "refresh_token" ? refreshAccessToken({ ...common, refreshToken: "refresh" })
      : exchangeAuthorizationCode({ ...common, code: "code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1/callback" });
    await expect(result).resolves.toMatchObject({ accessToken: "negotiated-access" });
  });
  it.each(["read\n", "\tread", "\n", "", " ", null, 7, ["read"]])("rejects malformed explicit token scope %j", async scope => {
    await expect(exchangeAuthorizationCode({
      tokenEndpoint: "https://auth.example.test/token", clientId: "client", code: "code", codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1/callback", resource: "https://resource.example.test/",
      fetch: async () => jsonResponse({ access_token: "access", token_type: "Bearer", scope }), now: () => 1000
    })).rejects.toThrow("OAuth scope");
  });
  it("normalizes surrounding whitespace from token strings before storing them", async () => {
    await expect(
      exchangeAuthorizationCode({
        tokenEndpoint: "https://auth.example.test/token",
        clientId: "client",
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1/callback",
        resource: "https://resource.example.test/",
        fetch: async () =>
          jsonResponse({
            access_token: "  access  ",
            refresh_token: "  refresh  ",
            token_type: "Bearer",
            scope: "  read write  "
          }),
        now: () => 1_000
      })
    ).resolves.toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: null,
      scope: "read write"
    });
  });

  it.each([
    { name: "string", expiresIn: "3600" },
    { name: "non-finite", expiresIn: Infinity },
    { name: "fractional", expiresIn: 1.5 },
    { name: "overflowing", expiresIn: 8_640_000_000_000 }
  ])("rejects $name expires_in values", async ({ expiresIn }) => {
    await expect(
      exchangeAuthorizationCode({
        tokenEndpoint: "https://auth.example.test/token",
        clientId: "client",
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1/callback",
        resource: "https://resource.example.test/",
        fetch: async () =>
          jsonResponse({
            access_token: "access",
            token_type: "Bearer",
            expires_in: expiresIn
          }),
        now: () => 1_700_000_000_000
      })
    ).rejects.toThrow("OAuth token response has invalid expires_in");
  });

  it("ignores inherited token response fields", async () => {
    await withObjectPrototypeProperties(
      {
        access_token: "polluted-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "polluted-refresh",
        scope: "polluted-scope"
      },
      async () => {
        await expect(
          exchangeAuthorizationCode({
            tokenEndpoint: "https://auth.example.test/token",
            clientId: "client",
            code: "code",
            codeVerifier: "verifier",
            redirectUri: "http://127.0.0.1/callback",
            resource: "https://resource.example.test/",
            fetch: async () => jsonResponse({}),
            now: () => 1_000
          })
        ).rejects.toThrow("OAuth token response missing access_token");
      }
    );
  });

  it("ignores inherited optional token response fields", async () => {
    await withObjectPrototypeProperties(
      {
        expires_in: -1,
        refresh_token: "polluted-refresh",
        scope: "polluted-scope"
      },
      async () => {
        await expect(
          exchangeAuthorizationCode({
            tokenEndpoint: "https://auth.example.test/token",
            clientId: "client",
            code: "code",
            codeVerifier: "verifier",
            redirectUri: "http://127.0.0.1/callback",
            resource: "https://resource.example.test/",
            fetch: async () =>
              jsonResponse({
                access_token: "access",
                token_type: "Bearer"
              }),
            now: () => 1_000
          })
        ).resolves.toEqual({
          accessToken: "access",
          tokenType: "Bearer",
          expiresAt: null
        });
      }
    );
  });

  it("ignores inherited OAuth error fields", async () => {
    await withObjectPrototypeProperties(
      {
        error: "invalid_grant",
        error_description: "polluted description",
        error_uri: "https://polluted.example.test/error"
      },
      async () => {
        const error = await readOAuthJsonObjectResponse(jsonResponse({}, 400)).catch(
          (caught: unknown) => caught
        );

        expect(error).toBeInstanceOf(OAuthError);
        expect(error).toMatchObject({
          error: "invalid_response",
          errorDescription: undefined,
          errorUri: undefined,
          status: 400
        });
      }
    );
  });
});

it.each([400, 401, 403, 404])("classifies malformed HTTP %s token responses as nonretryable with unknown consumption", async status => {
  const error = await readOAuthJsonObjectResponse(new Response("private-marker", { status })).catch((error: unknown) => error);
  expect(error).toMatchObject({ status, error: "invalid_response", retryable: false, terminal: true, outcomeKnown: false });
  expect(error.message).toContain(`HTTP ${status}`);
  expect(error.message).not.toContain("private-marker");
});
it.each([500, 503])("keeps malformed HTTP %s server responses retryable with unknown consumption", async status => {
  const error = await readOAuthJsonObjectResponse(new Response("private-marker", { status })).catch((error: unknown) => error);
  expect(error).toMatchObject({ status, retryable: true, terminal: false, outcomeKnown: false });
});

it.each([{}, { error: "" }, { error: "  " }, { error_description: "private-marker" }])("treats incomplete JSON OAuth errors as unstructured rejection: %j", async payload => {
  const error = await readOAuthJsonObjectResponse(Response.json(payload, { status: 403 })).catch((error: unknown) => error);
  expect(error).toMatchObject({ status: 403, error: "invalid_response", retryable: false, outcomeKnown: false });
  expect(error.message).toContain("HTTP 403");
  expect(error.message).not.toContain("private-marker");
});
