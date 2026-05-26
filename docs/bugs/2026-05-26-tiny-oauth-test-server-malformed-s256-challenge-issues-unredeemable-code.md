# Tiny OAuth test server malformed S256 challenge issues unredeemable code

## Summary

`tiny-oauth-test-server` requires PKCE with `code_challenge_method=S256`, but the authorization endpoint validates only the method name and accepts arbitrary `code_challenge` text. A request containing a malformed S256 challenge such as `not-a-sha256-code-challenge` receives an authorization code even though no valid PKCE verifier can redeem that code at the token endpoint.

## Reproduction

Create the following disposable probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(
  url: URL,
  init?: { method?: string; body?: string }
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: init?.method ?? "GET",
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers:
          init?.body === undefined
            ? undefined
            : { "Content-Type": "application/x-www-form-urlencoded" }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          ...(typeof res.headers.location === "string" ? { location: res.headers.location } : {}),
          body: Buffer.concat(chunks).toString("utf8")
        }));
      }
    );
    req.once("error", reject);
    if (init?.body !== undefined) req.write(init.body);
    req.end();
  });
}

describe("tiny OAuth malformed PKCE challenge", () => {
  it("issues a code for an S256 challenge that cannot match any valid verifier", async () => {
    const server = createOAuthTestServer({
      requireDcr: false,
      signingKeySeed: "malformed-pkce-probe",
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const redirectUri = "http://127.0.0.1:43123/callback";
      const resource = "https://resource.example.test/mcp";
      const authUrl = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        response_type: "code",
        client_id: "client",
        redirect_uri: redirectUri,
        code_challenge: "not-a-sha256-code-challenge",
        code_challenge_method: "S256",
        resource
      })) authUrl.searchParams.set(name, value);

      const authorization = await request(authUrl);
      const code = new URL(authorization.location ?? "http://invalid").searchParams.get("code") ?? "";
      const token = await request(new URL("/token", server.issuer), {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: "client",
          redirect_uri: redirectUri,
          code_verifier: "valid-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          resource
        }).toString()
      });

      console.log(JSON.stringify({
        authorizationStatus: authorization.status,
        codeIssued: code.length > 0,
        tokenStatus: token.status,
        tokenBody: token.body
      }));
      expect(authorization.status).toBe(302);
      expect(code.length).toBeGreaterThan(0);
      expect(token.status).toBe(400);
      expect(token.body).toContain("PKCE verifier mismatch");
    } finally {
      await handle.close();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The probe passes and demonstrates an authorization success followed by an unrecoverable token exchange failure:

```text
{"authorizationStatus":302,"codeIssued":true,"tokenStatus":400,"tokenBody":"{\"error\":\"invalid_grant\",\"error_description\":\"PKCE verifier mismatch\"}"}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth malformed PKCE challenge > issues a code for an S256 challenge that cannot match any valid verifier
```

## Observed Behavior

`handleAuthorize()` reads `code_challenge`, checks only that `code_challenge_method` equals `S256`, then persists the unvalidated challenge and sends an authorization-code redirect at `packages/tiny-oauth-test-server/src/index.ts:1024` through `packages/tiny-oauth-test-server/src/index.ts:1094`. It accepts `not-a-sha256-code-challenge`, which is not a base64url-encoded SHA-256 digest of the fixed length produced by S256 PKCE.

The token endpoint validates only the submitted `code_verifier` shape via `isValidPkceVerifier()` at `packages/tiny-oauth-test-server/src/index.ts:212` through `packages/tiny-oauth-test-server/src/index.ts:230` and `packages/tiny-oauth-test-server/src/index.ts:1266` through `packages/tiny-oauth-test-server/src/index.ts:1283`. It then computes a real SHA-256 challenge and compares it against the malformed stored challenge, returning `invalid_grant: PKCE verifier mismatch`. Thus the server issues a code that cannot complete its mandated PKCE exchange.

## Expected Behavior

For `code_challenge_method=S256`, the authorization endpoint should validate the supplied challenge as the allowed PKCE S256 representation before rendering consent or issuing a code. Malformed challenges should be rejected as invalid authorization requests rather than creating deliberately unredeemable authorization codes.

## Impact

Clients or tests can appear to complete authorization successfully, receive a redirect code, and fail only later during token exchange because the fixture accepted malformed PKCE input. This turns client-side request construction errors into misleading grant failures and prevents the test server from reliably validating S256 authorization requests at the correct protocol boundary.
