import { describe, expect, it } from "vitest";
import {
  OAuthError,
  exchangeAuthorizationCode,
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
            fetch: async () => jsonResponse({
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
          error: "server_error",
          errorDescription: undefined,
          errorUri: undefined,
          status: 400
        });
      }
    );
  });
});
