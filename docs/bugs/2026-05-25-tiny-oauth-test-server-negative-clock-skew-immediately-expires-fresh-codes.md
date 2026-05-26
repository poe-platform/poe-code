# Tiny OAuth test server negative clock skew immediately expires fresh codes

## Summary

`createOAuthTestServer()` accepts negative `clockSkewSeconds` values. A sufficiently negative value makes a brand-new authorization code fail token exchange immediately as expired, even though the authorization request just succeeded and returned the code.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(input: URL, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = http.request({
      hostname: input.hostname,
      port: Number(input.port),
      path: `${input.pathname}${input.search}`,
      method: init.method ?? "GET",
      headers: init.headers as http.OutgoingHttpHeaders | undefined,
    }, (response) => {
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      }));
    });
    call.on("error", reject);
    if (init.body !== undefined) call.write(init.body.toString());
    call.end();
  });
}

describe("negative clock skew", () => {
  it("expires a freshly issued authorization code immediately", async () => {
    const server = createOAuthTestServer({
      clockSkewSeconds: -301,
      requireDcr: false,
      defaultAuthorization: { autoApprove: true },
      signingKeySeed: "probe",
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });
    const redirectUri = "http://127.0.0.1:43123/callback";
    const resource = "https://resource.example.test/mcp";
    const verifier = "probe-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";

    try {
      const authorizationUrl = new URL("/authorize", server.issuer);
      authorizationUrl.searchParams.set("client_id", "client");
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("resource", resource);

      const authorization = await request(authorizationUrl);
      const code = new URL(authorization.headers.get("location")!).searchParams.get("code")!;
      const token = await request(new URL("/token", server.issuer), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "client",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource,
        }),
      });

      expect(token.status).toBe(400);
      await expect(token.json()).resolves.toMatchObject({ error: "invalid_grant" });
    } finally {
      await handle.close();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating the invalid configuration is accepted and makes the newly produced code unusable.

## Observed Behavior

`createOAuthTestServer()` copies `options.clockSkewSeconds` without validating its range in `packages/tiny-oauth-test-server/src/index.ts`. Authorization codes receive a five-minute expiry at issuance, but expiry validation computes `nowInSeconds() > expiresAt + clockSkewSeconds`. With `clockSkewSeconds: -301`, a code returned moments earlier is already treated as expired at the `/token` endpoint, which responds with HTTP `400` and `invalid_grant`.

## Expected Behavior

The server should reject negative `clockSkewSeconds` configuration values, or otherwise constrain clock skew so it can only extend permitted validation tolerance rather than shorten token and code validity periods.

## Impact

Tests and demos can configure an apparently valid OAuth fixture that successfully redirects with authorization codes but cannot exchange them for tokens. This creates misleading authentication failures in consuming applications and also affects refresh-token expiry handling, which uses the same skew calculation.
