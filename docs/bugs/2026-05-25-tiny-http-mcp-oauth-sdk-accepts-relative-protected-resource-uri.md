# Tiny HTTP MCP OAuth SDK accepts relative protected resource URI

## Summary

The exported `tiny-http-mcp-oauth-test-server` factory accepts an arbitrary `resource` string through its programmatic API and starts an OAuth-protected MCP fixture that publishes the supplied value as protected-resource metadata. A relative identifier such as `relative-resource` is accepted even though the README describes this value as a canonical protected resource URI and the package CLI rejects non-absolute `--resource` values.

## Reproduction

Create the disposable test file `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

describe("MCP OAuth fixture resource validation", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("starts and advertises a relative protected-resource identifier", async () => {
    const handle = await createMcpOAuthTestServer({ resource: "relative-resource" })
      .listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.push(handle.close);

    const response = await nodeFetch(handle.prmUrl);
    const metadata = JSON.parse(await response.text()) as { resource: string };

    expect(handle.resource).toBe("relative-resource");
    expect(metadata.resource).toBe("relative-resource");
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts
```

Result:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth fixture resource validation > starts and advertises a relative protected-resource identifier
```

## Observed Behavior

`McpOAuthTestServerOptions` exposes `resource?: string` in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:11` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:19`. During startup, `listenOnce()` uses `options.resource` unchanged when it is provided and passes that value into the MCP server's OAuth configuration in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:245` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:282`. The probe starts successfully with `resource: "relative-resource"`, and the server's protected-resource metadata publishes `"resource":"relative-resource"`.

This differs from the package's CLI path, which validates `--resource` with `new URL(value)` and rejects non-absolute values in `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:105` through `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:117` and `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:161` through `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:175`. The README likewise documents `resource` as the canonical protected resource URI in `packages/tiny-http-mcp-oauth-test-server/README.md:172` through `packages/tiny-http-mcp-oauth-test-server/README.md:194`.

## Expected Behavior

The programmatic factory should enforce the same absolute protected-resource URI requirement as the CLI before starting the fixture, or clearly define a different supported contract. A relative string must not be silently advertised as the OAuth protected-resource identifier and token audience.

## Impact

SDK consumers can instantiate a seemingly valid OAuth MCP test server with malformed protected-resource metadata and audience values that cannot represent the intended canonical resource. Tests built on the fixture may exercise invalid OAuth discovery behavior or fail only when interoperating clients require an absolute resource URI, while equivalent CLI configuration fails immediately with a clear validation error.
