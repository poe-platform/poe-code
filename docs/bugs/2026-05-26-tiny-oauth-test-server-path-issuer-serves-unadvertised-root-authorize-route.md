# Tiny OAuth test server path issuer serves unadvertised root authorize route

## Summary

When configured with a path-based issuer such as `http://127.0.0.1:<port>/oauth`, `tiny-oauth-test-server` publishes an authorization endpoint under that issuer path, but also silently serves a root `/authorize` alias. A request sent to the unadvertised root route succeeds and receives an authorization-code redirect carrying the pathful issuer, so the server accepts authorization traffic outside the endpoint namespace described by its metadata.

## Reproduction

Create the following disposable probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(url: URL): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          location: String(res.headers.location ?? "")
        });
        res.resume();
      }
    );
    req.once("error", reject);
    req.end();
  });
}

describe("tiny OAuth path issuer root endpoint alias", () => {
  it("issues authorization codes at an unadvertised root route", async () => {
    const server = createOAuthTestServer({
      issuer: "http://127.0.0.1:43187/oauth",
      requireDcr: false,
      signingKeySeed: "path-alias-probe",
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 43187 });

    try {
      const redirectUri = "http://127.0.0.1:43123/callback";
      const verifier = "path-alias-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ123";
      const unadvertised = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        response_type: "code",
        client_id: "client",
        redirect_uri: redirectUri,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        resource: "https://resource.example.test/mcp"
      })) unadvertised.searchParams.set(name, value);

      const response = await request(unadvertised);
      console.log(JSON.stringify({
        issuer: server.issuer,
        unadvertisedPath: unadvertised.pathname,
        status: response.status,
        location: response.location
      }));
      expect(response.status).toBe(302);
      expect(response.location).toContain("code=");
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

The probe passes and prints a successful redirect from the unadvertised root endpoint:

```text
{"issuer":"http://127.0.0.1:43187/oauth","unadvertisedPath":"/authorize","status":302,"location":"http://127.0.0.1:43123/callback?code=...&iss=http%3A%2F%2F127.0.0.1%3A43187%2Foauth"}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth path issuer root endpoint alias > issues authorization codes at an unadvertised root route
```

## Observed Behavior

For a pathful issuer, `getEndpointPaths()` derives and publishes an authorization URL at the issuer-scoped route such as `/oauth/authorize` at `packages/tiny-oauth-test-server/src/index.ts:375` through `packages/tiny-oauth-test-server/src/index.ts:431` and exposes it in metadata at `packages/tiny-oauth-test-server/src/index.ts:905` through `packages/tiny-oauth-test-server/src/index.ts:920`. However, the same helper populates `authorizePaths` with both the derived route and the root alias `"/authorize"` whenever the issuer has a path.

The request dispatcher accepts any path included in `authorizePaths` at `packages/tiny-oauth-test-server/src/index.ts:835` through `packages/tiny-oauth-test-server/src/index.ts:892`. As a result, an OAuth server configured and advertised as `http://127.0.0.1:43187/oauth` processes an authorization request at `http://127.0.0.1:43187/authorize` and issues a code response whose `iss` remains the path-based issuer.

## Expected Behavior

For a non-root issuer path, the server should process authorization requests only at the endpoints derived for that issuer and advertised in its metadata, unless aliases are explicitly requested and documented. An unadvertised root `/authorize` route should return `404` rather than issuing an authorization code for a path-scoped authorization server.

## Impact

Clients and tests cannot rely on endpoint namespace isolation when using realistic path-based issuers. Requests accidentally sent to root OAuth routes still succeed, masking incorrect discovery or routing behavior in applications under test and allowing traffic intended for a different virtual authorization-server namespace to be accepted by the fixture.
