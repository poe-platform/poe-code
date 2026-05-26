# Tiny OAuth test server HTTP issue-token string TTL silently uses default

## Summary

The `/testing/issue-token` HTTP endpoint accepts an explicitly malformed `ttl_seconds` JSON value such as a string and silently substitutes the configured default TTL. Instead of rejecting invalid request data, the endpoint returns HTTP `200` and a token whose expiry differs from the supplied input.

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

describe("invalid HTTP issue-token TTL", () => {
  it("silently defaults a string TTL rather than rejecting malformed JSON input", async () => {
    const server = createOAuthTestServer({
      signingKeySeed: "probe",
      defaultTokenTtlSeconds: 60,
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const response = await request(
        new URL("/testing/issue-token", server.issuer),
        JSON.stringify({
          client_id: "client",
          resource: "https://resource.example.test/mcp",
          scopes: ["mcp.read"],
          ttl_seconds: "never",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ expires_in: 60 });
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

The probe passes: the invalid string-valued TTL request succeeds and is represented in the response as the default `expires_in: 60`.

## Observed Behavior

`handleIssueToken()` inspects `payload.ttl_seconds` and only uses the supplied value when it is a finite number. Any other present type, including a string, is treated identically to an omitted property through the expression `typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) ? Math.floor(ttlSeconds) : defaultTokenTtlSeconds`. The endpoint then mints a token and responds successfully using the default TTL.

## Expected Behavior

If `ttl_seconds` is present, the endpoint should validate it and reject nonnumeric or otherwise malformed values with `invalid_request`. Defaulting should apply only when the optional field is absent, not when callers explicitly send invalid data.

## Impact

HTTP-based fixture consumers can believe they requested one expiration policy while receiving another token successfully. Invalid test data is hidden rather than surfaced, making expiration assertions unreliable and obscuring client serialization or configuration defects.
