# Tiny OAuth test server registration array scope silently omitted

## Summary

The dynamic client registration endpoint accepts a present but invalid array-valued `scope` field and silently removes it from the created client. A request sending `scope: ["mcp.read"]` succeeds with HTTP `201`, but the returned client registration has no scope policy at all.

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

describe("registration malformed scope type", () => {
  it("silently omits a supplied array-valued scope", async () => {
    const server = createOAuthTestServer({ signingKeySeed: "probe" });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const response = await request(
        new URL("/register", server.issuer),
        JSON.stringify({
          redirect_uris: ["http://127.0.0.1:43123/callback"],
          scope: ["mcp.read"],
        }),
      );

      expect(response.status).toBe(201);
      const body = await response.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty("scope");
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

The probe passes: the malformed registration succeeds while omitting its explicitly supplied scope declaration.

## Observed Behavior

`handleRegister()` evaluates `const scope = typeof payload.scope === "string" ? parseScope(payload.scope) : undefined`. Any supplied non-string value is treated exactly like absence of the optional field. The endpoint consequently stores no scope allowlist and returns a successful registration response without `scope`, rather than reporting invalid client metadata.

## Expected Behavior

When `scope` is supplied in registration metadata, the server should validate that it is a supported string representation and reject invalid types. Omitting a malformed field must not convert a constrained registration attempt into an unconstrained client registration.

## Impact

Client registration serialization bugs can silently remove intended scope restrictions from an OAuth fixture. Subsequent authorization requests may be accepted under broader policy than the caller configured, weakening negative authorization tests and hiding malformed integration requests.
