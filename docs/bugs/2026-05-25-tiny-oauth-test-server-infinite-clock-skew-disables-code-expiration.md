# Tiny OAuth test server infinite clock skew disables code expiration

## Summary

`createOAuthTestServer()` accepts `clockSkewSeconds: Infinity`. Because authorization-code and refresh-token expiry checks add the configured skew to the expiry timestamp, positive infinity makes those credentials never expire during the process lifetime.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(input: URL, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = http.request({
      hostname: input.hostname,
      port: Number(input.port),
      path: `${input.pathname}${input.search}`,
      method: init.method ?? "GET",
      headers: init.headers as http.OutgoingHttpHeaders | undefined,
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    if (init.body !== undefined) call.write(init.body.toString());
    call.end();
  });
}

afterEach(() => vi.useRealTimers());

describe("non-finite clock skew", () => {
  it("exchanges an authorization code long after its five-minute lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    const server = createOAuthTestServer({
      clockSkewSeconds: Number.POSITIVE_INFINITY,
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
      for (const [name, value] of Object.entries({
        client_id: "client",
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        resource,
      })) authorizationUrl.searchParams.set(name, value);
      const authorization = await request(authorizationUrl);
      const code = new URL(authorization.headers.get("location")!).searchParams.get("code")!;

      vi.advanceTimersByTime(301_000);
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

      expect(token.status).toBe(200);
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

The probe passes: a code minted at noon is still exchanged successfully after the clock advances past its five-minute lifetime.

## Observed Behavior

The factory retains `options.clockSkewSeconds` as-is. Authorization codes are stored with `expiresAt: nowInSeconds() + 300`, while `isExpired()` tests `nowInSeconds() > expiresAt + clockSkewSeconds`. With `clockSkewSeconds: Infinity`, `expiresAt + clockSkewSeconds` evaluates to `Infinity`, so `isExpired()` can never return true. The same function is used for refresh-token expiry.

## Expected Behavior

`clockSkewSeconds` should reject non-finite values and represent a bounded finite tolerance only. Configuring validation tolerance must not convert temporary authorization or refresh credentials into indefinitely usable credentials.

## Impact

OAuth fixture consumers can silently run tests against authorization codes and refresh tokens that do not expire, masking expiry enforcement defects in applications under test. A stale code or refresh token remains redeemable indefinitely until consumed, revoked, or the server process is discarded.
