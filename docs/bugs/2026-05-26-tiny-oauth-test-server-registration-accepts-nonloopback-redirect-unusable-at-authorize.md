# Tiny OAuth test server registration accepts non-loopback redirect unusable at authorize

## Summary

The dynamic client registration endpoint in `tiny-oauth-test-server` accepts an absolute HTTPS redirect URI and successfully issues a client identifier, but the authorization endpoint rejects that same registered redirect because the fixture supports only loopback HTTP origins. A registration can therefore report success while producing a client that cannot use any of its declared redirect URIs in the server's authorization flow.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

function request(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(target, { method: init?.method ?? "GET", headers: init?.headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    req.once("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

describe("tiny OAuth dynamic non-loopback redirect", () => {
  it("registers an HTTPS redirect URI that cannot be used for authorization", async () => {
    const server = createOAuthTestServer({ defaultAuthorization: { autoApprove: true } });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });
    try {
      const redirectUri = "https://client.example.test/callback";
      const registration = await request(`${server.issuer}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirectUri] })
      });
      expect(registration.status).toBe(201);
      const clientId = (JSON.parse(registration.body) as { client_id: string }).client_id;
      const authorization = new URL(`${server.issuer}/authorize`);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("client_id", clientId);
      authorization.searchParams.set("redirect_uri", redirectUri);
      authorization.searchParams.set("code_challenge", "a".repeat(43));
      authorization.searchParams.set("code_challenge_method", "S256");
      authorization.searchParams.set("resource", "https://resource.example.test/mcp");

      const rejected = await request(authorization.toString());
      expect(rejected.status).toBe(400);
      expect(rejected.body).toContain("redirect_uri must use a loopback HTTP origin");
    } finally {
      await handle.close();
    }
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth dynamic non-loopback redirect > registers an HTTPS redirect URI that cannot be used for authorization
```

## Observed Behavior

`handleRegister()` requires only a non-empty array of absolute, fragment-free redirect URIs, normalizing each through `parseAbsoluteUrl()` and persisting the client at `packages/tiny-oauth-test-server/src/index.ts:923` through `packages/tiny-oauth-test-server/src/index.ts:1012`. It consequently returns HTTP `201` for `https://client.example.test/callback`. Later, the authorization endpoint evaluates `redirect_uri` with `isLoopbackRedirectUri()` at `packages/tiny-oauth-test-server/src/index.ts:181` through `packages/tiny-oauth-test-server/src/index.ts:210` and rejects non-loopback URLs before the registered-client match at `packages/tiny-oauth-test-server/src/index.ts:1026` through `packages/tiny-oauth-test-server/src/index.ts:1045`. Thus the freshly issued dynamic client is unusable with its sole registered redirect URI.

## Expected Behavior

Dynamic client registration should reject redirect URIs that the authorization endpoint cannot accept, or the authorization flow should honor valid registered redirects consistently with the registration contract. The fixture should not issue successful registrations whose declared callback set is unusable by construction.

## Impact

Tests using realistic hosted OAuth callback URLs can appear to complete RFC 7591 dynamic registration successfully, only to fail later during authorization with a redirect validation error. This masks client-registration compatibility problems as authorization failures and prevents the fixture from faithfully exercising registered non-loopback public-client redirect flows.
