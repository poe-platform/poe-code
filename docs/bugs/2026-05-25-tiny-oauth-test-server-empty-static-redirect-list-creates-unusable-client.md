# Tiny OAuth test server empty static redirect list creates unusable client

## Summary

`createOAuthTestServer()` accepts a static client with `redirectUris: []`, even though dynamically registered clients must supply a non-empty redirect URI array. The fixture initializes and listens successfully with a preconfigured client that can never complete authorization.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
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

describe("empty static redirect list", () => {
  it("accepts an unusable configured client that can never authorize", async () => {
    const server = createOAuthTestServer({
      signingKeySeed: "probe",
      staticClients: [{ clientId: "client", redirectUris: [] }],
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const url = new URL("/authorize", server.issuer);
      for (const [name, value] of Object.entries({
        client_id: "client",
        redirect_uri: "http://127.0.0.1:43123/callback",
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        resource: "https://resource.example.test/mcp",
      })) url.searchParams.set(name, value);
      const response = await request(url);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
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

The probe passes: server construction and listening succeed, while the declared static client rejects its attempted loopback redirect because there is no configured URI it can ever match.

## Observed Behavior

`handleRegister()` rejects dynamic client registration unless `redirect_uris` is a non-empty array. In contrast, `normalizeStaticClient()` validates each provided redirect URI but never verifies that the array contains at least one entry. A static declaration with `redirectUris: []` is stored, and `resolveClientForAuthorization()` then always fails its `some(...)` match for every requested redirect URI.

## Expected Behavior

Static-client configuration should enforce the same non-empty redirect URI invariant as dynamic registration. The factory should reject a static client that cannot participate in any supported authorization flow instead of accepting an unusable declaration.

## Impact

Test fixtures can start successfully with a preloaded client that deterministically fails every browser authorization attempt. This delays feedback about configuration mistakes and turns setup defects into misleading OAuth request failures during integration testing.
