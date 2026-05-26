# Tiny stdio MCP test server advertises stale package version

## Summary

The published `tiny-stdio-mcp-test-server` package declares version `0.1.0`, but every exported server factory reports version `0.0.1` in its MCP `initialize` response, and its CLI reports the same stale version. MCP clients and test harnesses therefore observe an implementation identity that does not match the installed package release.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { createTestServer } from "./index.js";

describe("test server published version identity", () => {
  it("advertises a stale MCP server version instead of its package version", async () => {
    const response = await createTestServer().handleMessage("initialize", {});

    expect(packageJson.version).toBe("0.1.0");
    expect(response.result).toMatchObject({
      serverInfo: { name: "tiny-stdio-mcp-test-server", version: "0.0.1" }
    });
    expect(response.result?.serverInfo.version).not.toBe(packageJson.version);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts > test server published version identity > advertises a stale MCP server version instead of its package version
```

## Observed Behavior

`package.json` identifies the installable package as version `0.1.0`, while `createTestServer().handleMessage("initialize", {})` returns `serverInfo.version: "0.0.1"`. The stale value is hard-coded into `createEncryptServer()`, `createWordOfTheDayServer()`, and `createTestServer()` in `packages/tiny-stdio-mcp-test-server/src/index.ts`; the CLI likewise hard-codes `.version("0.0.1")` in `packages/tiny-stdio-mcp-test-server/src/cli.ts`. The package's existing SDK initialization test currently asserts the stale server identity rather than the release metadata.

## Expected Behavior

A released MCP server package should identify itself consistently across package metadata, CLI version output, and the `initialize` protocol handshake. Version identity should be derived from one canonical release value or kept synchronized so clients observing the server can reliably determine which package build is running.

## Impact

Integration tests, compatibility diagnostics, bug reports, telemetry, and cached capability decisions can attribute behavior from the installed `0.1.0` server to `0.0.1`. This makes version-sensitive failures difficult to reproduce and can cause consumers to apply the wrong compatibility assumptions or suppress upgrade guidance for a newer installed package.
