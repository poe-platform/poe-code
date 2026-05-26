# Tiny OAuth test server registered client without refresh grant can refresh

## Summary

`tiny-oauth-test-server` accepts dynamic client registration metadata containing a restricted `grant_types` list and echoes that restriction back in its successful registration response, but does not enforce it afterward. A client registered with only `grant_types: ["authorization_code"]` still receives a refresh token during authorization-code exchange and successfully rotates that token using the undeclared `refresh_token` grant.

## Reproduction

Create the following disposable probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(
  url: URL,
  init?: { method?: string; body?: string; json?: unknown }
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const body = init?.json === undefined ? init?.body : JSON.stringify(init.json);
    const req = http.request(
      {
        method: init?.method ?? "GET",
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: body === undefined ? undefined : {
          "Content-Type": init?.json === undefined
            ? "application/x-www-form-urlencoded"
            : "application/json"
        }
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
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("tiny OAuth registered grant policy", () => {
  it("rotates a refresh token for a client registered without the refresh_token grant", async () => {
    const server = createOAuthTestServer({
      signingKeySeed: "registration-grant-probe",
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const redirectUri = "http://127.0.0.1:43123/callback";
      const resource = "https://resource.example.test/mcp";
      const registration = await request(new URL("/register", server.issuer), {
        method: "POST",
        json: {
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"]
        }
      });
      const clientId = (JSON.parse(registration.body) as { client_id: string }).client_id;
      const verifier = "registered-grant-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const authUrl = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        resource
      })) authUrl.searchParams.set(name, value);
      const authorization = await request(authUrl);
      const code = new URL(authorization.location ?? "http://invalid").searchParams.get("code") ?? "";
      const token = await request(new URL("/token", server.issuer), {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource
        }).toString()
      });
      const refreshToken = (JSON.parse(token.body) as { refresh_token: string }).refresh_token;
      const refreshed = await request(new URL("/token", server.issuer), {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: refreshToken,
          resource
        }).toString()
      });

      console.log(JSON.stringify({
        registrationStatus: registration.status,
        registration: JSON.parse(registration.body),
        tokenStatus: token.status,
        refreshedStatus: refreshed.status
      }));
      expect(registration.status).toBe(201);
      expect(JSON.parse(registration.body)).toMatchObject({
        grant_types: ["authorization_code"]
      });
      expect(token.status).toBe(200);
      expect(refreshed.status).toBe(200);
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

The probe passes and prints a successful refresh for a registration that explicitly excluded the refresh grant:

```text
{"registrationStatus":201,"registration":{"client_id":"client_000001","client_id_issued_at":1779803389,"redirect_uris":["http://127.0.0.1:43123/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"response_types":["code"]},"tokenStatus":200,"refreshedStatus":200}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth registered grant policy > rotates a refresh token for a client registered without the refresh_token grant
```

## Observed Behavior

`handleRegister()` validates and returns `grant_types`, including the restricted array `["authorization_code"]`, at `packages/tiny-oauth-test-server/src/index.ts:922` through `packages/tiny-oauth-test-server/src/index.ts:1012`. However, `StoredClient` contains only redirect URIs, scopes, and metadata at `packages/tiny-oauth-test-server/src/index.ts:78` through `packages/tiny-oauth-test-server/src/index.ts:83`; the validated grant policy is not retained for runtime checks.

After code exchange, `createTokenResponse()` always creates and returns a refresh token at `packages/tiny-oauth-test-server/src/index.ts:1335` through `packages/tiny-oauth-test-server/src/index.ts:1366`. `handleToken()` dispatches all `refresh_token` requests directly to `rotateRefreshToken()` at `packages/tiny-oauth-test-server/src/index.ts:1158` through `packages/tiny-oauth-test-server/src/index.ts:1179`, and rotation checks only the stored token's client and resource binding at `packages/tiny-oauth-test-server/src/index.ts:1297` through `packages/tiny-oauth-test-server/src/index.ts:1329`. It never checks whether the dynamically registered client declared the refresh grant.

## Expected Behavior

Registration metadata that restricts a client's allowed grant types should be enforced consistently. A client registered without `refresh_token` should not receive refresh credentials from an authorization-code exchange and must not successfully invoke refresh-token rotation.

## Impact

Integration tests can successfully register a deliberately restricted public client while the fixture silently grants additional long-lived credential behavior outside that registration contract. This prevents the test server from detecting clients or authorization-server flows that incorrectly issue or accept refresh tokens despite declared dynamic-registration policy.
