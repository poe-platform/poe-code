# Tiny OAuth test server duplicate static client ID silently replaces earlier policy

## Summary

`createOAuthTestServer()` accepts multiple `staticClients` entries with the same `clientId` and silently retains only the last declaration. Earlier registered redirect and scope policy is replaced without an error, so authorization behaves according to a different configured client than callers may believe they declared.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(input: URL): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = http.request({
      hostname: input.hostname,
      port: Number(input.port),
      path: `${input.pathname}${input.search}`,
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    call.end();
  });
}

describe("duplicate static client ids", () => {
  it("silently replaces the first declared client configuration with the second", async () => {
    const firstRedirect = "http://127.0.0.1:43123/callback";
    const secondRedirect = "http://127.0.0.1:43124/callback";
    const server = createOAuthTestServer({
      signingKeySeed: "probe",
      defaultAuthorization: { autoApprove: true },
      staticClients: [
        { clientId: "client", redirectUris: [firstRedirect], scopes: ["mcp.read"] },
        { clientId: "client", redirectUris: [secondRedirect], scopes: ["mcp.admin"] },
      ],
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const url = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        client_id: "client",
        redirect_uri: firstRedirect,
        response_type: "code",
        code_challenge: createHash("sha256")
          .update("probe-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef")
          .digest("base64url"),
        code_challenge_method: "S256",
        resource: "https://resource.example.test/mcp",
        scope: "mcp.read",
      })) url.searchParams.set(name, value);
      const response = await request(url);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_scope" });
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

The probe passes. A request that complies with the first static declaration is rejected using the later declaration's `mcp.admin` policy instead.

## Observed Behavior

The factory builds `staticClients` with `new Map((options.staticClients ?? []).map(...))`. When two entries normalize to the same `clientId`, JavaScript `Map` construction retains only the latter value without reporting a duplicate. Consequently, resolving `clientId: "client"` uses the second entry's scope allowlist, causing a request for the first declaration's allowed `mcp.read` scope to fail with `invalid_scope`.

## Expected Behavior

Static client identifiers should be unique configuration keys. The factory should reject duplicate `clientId` declarations at setup time rather than silently select one policy and discard another.

## Impact

Misconfigured tests can run under unexpected redirect and scope policy while setup appears successful. In fixtures containing repeated IDs, a later declaration can silently broaden, restrict, or redirect authorization behavior, obscuring the actual security policy being exercised by integration tests.
