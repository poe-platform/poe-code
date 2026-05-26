# Tiny OAuth test server empty static client scopes allow arbitrary grants

## Summary

`createOAuthTestServer()` treats a static client's explicit `scopes: []` configuration as if no scope restriction were configured. A client declared with an empty allowlist can request and receive arbitrary OAuth scopes such as `mcp.admin`.

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
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    if (init.body !== undefined) call.write(init.body.toString());
    call.end();
  });
}

describe("empty configured scope allowlist", () => {
  it("authorizes an arbitrary requested scope for a static client configured with none", async () => {
    const redirectUri = "http://127.0.0.1:43123/callback";
    const resource = "https://resource.example.test/mcp";
    const verifier = "probe-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
    const server = createOAuthTestServer({
      signingKeySeed: "probe",
      staticClients: [{ clientId: "client", redirectUris: [redirectUri], scopes: [] }],
      defaultAuthorization: { autoApprove: true },
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const url = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        client_id: "client",
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        resource,
        scope: "mcp.admin",
      })) url.searchParams.set(name, value);
      const authorization = await request(url);
      expect(authorization.status).toBe(302);
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
      const body = await tokenResponse.json() as { scope: string };

      expect(body.scope).toBe("mcp.admin");
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

The probe passes: the client configured with no allowed scopes receives a token containing `mcp.admin`.

## Observed Behavior

`normalizeStaticClient()` preserves an explicitly supplied empty `scopes` array. During authorization, `assertAllowedScopes()` returns immediately when `client.scopes` is either `undefined` **or has length zero**. This collapses the meaningful distinction between “no allowlist configured” and “the allowlist contains no permitted scopes,” allowing a request for `mcp.admin` to proceed and be minted into the token response.

## Expected Behavior

An explicit static-client scope allowlist should be enforced even when empty: `scopes: []` should permit no requested scopes. Only an omitted `scopes` field should represent unrestricted or unspecified scope policy, if that behavior is intended by the fixture API.

## Impact

Tests that configure a client to receive no scopes can instead issue privileged tokens for arbitrary scopes. This undermines negative authorization tests and may make application code appear to enforce least-privilege behavior when the fixture silently grants capabilities that the test configuration explicitly attempted to deny.
