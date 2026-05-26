# Tiny OAuth test server configured scope entry expands into multiple token scopes

## Summary

`createOAuthTestServer()` accepts configured `scopes` array entries containing embedded spaces in both `staticClients` and `defaultAuthorization`. An entry such as `"mcp.read mcp.admin"` passes the client allowlist as one configured value but is emitted in the token's space-delimited `scope` claim as two effective OAuth scopes.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { decodeJwt } from "jose";
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
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    if (init.body !== undefined) call.write(init.body.toString());
    call.end();
  });
}

describe("configured scope token validation", () => {
  it("turns one allowlisted configured entry into two granted scopes", async () => {
    const redirectUri = "http://127.0.0.1:43123/callback";
    const resource = "https://resource.example.test/mcp";
    const verifier = "probe-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
    const server = createOAuthTestServer({
      signingKeySeed: "probe",
      staticClients: [{
        clientId: "client",
        redirectUris: [redirectUri],
        scopes: ["mcp.read mcp.admin"],
      }],
      defaultAuthorization: {
        autoApprove: true,
        scopes: ["mcp.read mcp.admin"],
      },
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

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
      const tokenResponse = await request(new URL("/token", server.issuer), {
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
      const body = await tokenResponse.json() as { scope: string; access_token: string };

      expect(body.scope).toBe("mcp.read mcp.admin");
      expect(String(decodeJwt(body.access_token).scope).split(" ")).toEqual(["mcp.read", "mcp.admin"]);
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

The probe passes, proving a single accepted configured scope item becomes two effective scopes in the issued token.

## Observed Behavior

`normalizeStaticClient()` copies `input.scopes` without checking that each array member is one OAuth scope token. `defaultAuthorization.scopes` is also copied without validation. During authorization, `assertAllowedScopes()` compares the full string entry and allows `"mcp.read mcp.admin"` because it exactly matches the single configured allowlist member. Token response construction and JWT signing then serialize scopes with `join(" ")`, making the resulting `scope` value indistinguishable from two separately granted scopes: `mcp.read` and `mcp.admin`.

## Expected Behavior

Declarative scope arrays should accept only individual OAuth scope-token values and reject entries containing separators such as spaces. The server must not validate a configured grant as one scope and emit it as multiple effective scopes in token responses and JWT claims.

## Impact

Tests that use static clients or preset authorization decisions can unintentionally mint access tokens with broader privileges than the declarative configuration appears to grant. This defeats scope allowlisting in the fixture and can cause authorization test cases to pass with an elevated token that a real OAuth server would not issue from the same malformed configuration.
