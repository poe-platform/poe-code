# Tiny HTTP MCP OAuth SDK fragment issuer rejected only at listen

## Summary

`createMcpOAuthTestServer()` accepts an issuer URL containing a fragment at construction time even though that issuer cannot be used by the embedded OAuth server. The invalid option is reported only when `listen()` later creates the underlying authorization server, unlike other unsafe issuer forms that the wrapper rejects immediately.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

describe("SDK issuer fragment", () => {
  it("accepts a fragment-bearing issuer at construction and rejects only while listening", async () => {
    const create = () => createMcpOAuthTestServer({
      issuer: "http://127.0.0.1:43198/oauth#tenant",
    });

    expect(create).not.toThrow();
    await expect(create().listen({ hostname: "127.0.0.1", port: 0 }))
      .rejects.toThrow("issuer must not include a fragment");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes: the wrapper accepts the invalid issuer during configuration but rejects only during asynchronous server startup.

## Observed Behavior

At construction, `parseHttpUrl()` validates that the configured issuer is absolute, uses `http:`, and includes a non-root pathname, but it never rejects a fragment. During `listen()`, the wrapper forwards the stored URL into `createOAuthTestServer({ issuer })`; the embedded server's `parseAbsoluteUrl()` then rejects `#tenant` with `issuer must not include a fragment`. This makes issuer validation inconsistent across two layers and delays the error until listener creation.

## Expected Behavior

The wrapper should validate the complete issuer contract synchronously when `createMcpOAuthTestServer()` receives an explicit issuer. Unsupported fragment-bearing issuers should fail at the same configuration boundary as unsupported schemes and root-only issuer paths.

## Impact

Applications can successfully construct and retain an unusable fixture configuration, only to fail when attempting startup later in a test or demo flow. The delayed validation complicates setup diagnostics, teardown handling, and configuration-validation tests that rely on constructor-time feedback.
