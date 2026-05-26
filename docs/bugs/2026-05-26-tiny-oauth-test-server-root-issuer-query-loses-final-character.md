# Tiny OAuth test server root issuer query loses final character

## Summary

The public `createOAuthTestServer()` API accepts an issuer whose path is `/` and whose URL contains a query string, but normalizes it by removing the final character of the full serialized URL instead of removing only a trailing pathname slash. An issuer such as `http://127.0.0.1:<port>/?tenant=x` is silently changed to `http://127.0.0.1:<port>/?tenant=`, so the server publishes and signs tokens with a different issuer identifier than configured.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function reservePort(): Promise<number> {
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

describe("tiny OAuth root issuer query normalization", () => {
  it("silently deletes the final query character from a configured issuer", async () => {
    const port = await reservePort();
    const configured = `http://127.0.0.1:${port}/?tenant=x`;
    const server = createOAuthTestServer({ issuer: configured });
    const handle = await server.listen({ port, hostname: "127.0.0.1" });

    try {
      expect(server.issuer).toBe(`http://127.0.0.1:${port}/?tenant=`);
      expect(server.issuer).not.toBe(configured);
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
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth root issuer query normalization > silently deletes the final query character from a configured issuer
```

## Observed Behavior

`normalizeIssuer()` parses the supplied issuer, removes URL fragments, serializes it, and then executes `serialized.slice(0, -1)` whenever `url.pathname === "/"` at `packages/tiny-oauth-test-server/src/index.ts:811` through `packages/tiny-oauth-test-server/src/index.ts:819`. When a root-path URL carries query data, the trailing character belongs to the query rather than to the pathname slash. The public `server.issuer` getter at `packages/tiny-oauth-test-server/src/index.ts:685` through `packages/tiny-oauth-test-server/src/index.ts:690` exposes the truncated value, and access-token issuance passes that altered issuer into JWT creation at `packages/tiny-oauth-test-server/src/index.ts:1215` through `packages/tiny-oauth-test-server/src/index.ts:1220` and `packages/tiny-oauth-test-server/src/index.ts:1380` through `packages/tiny-oauth-test-server/src/index.ts:1392`.

## Expected Behavior

Issuer normalization should preserve query-string content exactly, or reject issuer URLs with query components before startup if they are unsupported. Removing an optional root pathname separator must not delete characters from the configured issuer identifier.

## Impact

Tests that configure a query-bearing issuer receive metadata and JWTs bound to an issuer different from the value they supplied. External verifiers or discovery assertions using the configured issuer can reject otherwise valid fixture tokens, while logs and diagnostics show an altered tenant or routing parameter, obscuring the actual cause of authorization failures.
