# Tiny OAuth test server registration object auth method silently defaults to none

## Summary

The dynamic client registration endpoint accepts an explicitly malformed object-valued `token_endpoint_auth_method` field and silently registers the client using `"none"`. Instead of rejecting invalid client metadata, it converts the supplied unsupported value into public-client authentication semantics.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(input: URL, body: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = http.request({
      hostname: input.hostname,
      port: Number(input.port),
      path: input.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    call.end(body);
  });
}

describe("registration malformed token authentication method", () => {
  it("silently defaults a supplied object method to none", async () => {
    const server = createOAuthTestServer({ signingKeySeed: "probe" });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const response = await request(
        new URL("/register", server.issuer),
        JSON.stringify({
          redirect_uris: ["http://127.0.0.1:43123/callback"],
          token_endpoint_auth_method: { method: "client_secret_basic" },
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        token_endpoint_auth_method: "none",
      });
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

The probe passes: invalid auth-method metadata succeeds and is returned as the default public-client method.

## Observed Behavior

`handleRegister()` assigns `tokenEndpointAuthMethod` to `payload.token_endpoint_auth_method` only when the supplied value is a string; every other present type falls back to `"none"`. Its later supported-method check therefore validates the fallback rather than the submitted object. The endpoint issues a successful client registration representing a different authentication policy than the request sent.

## Expected Behavior

When `token_endpoint_auth_method` is present, its type should be validated and malformed values rejected as invalid client metadata. The default `"none"` should apply only when the optional property is omitted.

## Impact

Malformed registration clients can silently become unauthenticated public clients, hiding serialization bugs and weakening fixture security assumptions. Tests may exercise a no-secret token exchange while believing they registered a client authentication requirement.
