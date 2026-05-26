# Toolcraft MCP proxy refresh failure deletes usable cache

## Summary

`toolcraft`'s MCP proxy resolution deletes an existing on-disk tools cache immediately when `TOOLCRAFT_MCP_REFRESH` requests a refresh, before it has successfully connected to the upstream MCP server and written a replacement. If that upstream connection or discovery fails, resolution rejects after the previous valid cache has already been removed. A transient refresh outage therefore destroys the only cached tool manifest that could have supported later offline or non-refresh startup.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, vol } from "memfs";
import { defineGroup } from "./index.js";

const mockFsPromises = createFsFromVolume(vol).promises;

vi.mock("@poe-code/design-system", () => ({
  createLogger: () => ({ info: () => undefined })
}));
vi.mock("node:fs/promises", () => mockFsPromises);
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});
vi.mock("tiny-mcp-client", () => ({
  McpClient: class MockMcpClient {
    async connect() {
      throw new Error("upstream unavailable");
    }
    async close() {}
  },
  StdioTransport: class MockStdioTransport {},
  HttpTransport: class MockHttpTransport {}
}));

const { resolveMcpProxies } = await import("./mcp-proxy.js");

describe("MCP proxy failed refresh probe", () => {
  beforeEach(() => {
    vol.reset();
    process.env.TOOLCRAFT_MCP_REFRESH = "github";
  });

  it("deletes a usable cache before a failing upstream refresh", async () => {
    const cachePath = "/repo/.toolcraft/mcp/github.json";
    vol.fromJSON({
      "/repo/package.json": JSON.stringify({ name: "repo" }),
      [cachePath]: JSON.stringify({
        $schema: "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
        version: 1,
        fetchedAt: "2026-05-25T00:00:00.000Z",
        upstream: { name: "cached", version: "1.0.0" },
        tools: [{ name: "cached_tool", inputSchema: { type: "object", properties: {} } }]
      })
    });
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "github",
          mcp: { transport: "stdio", command: "mock-server" },
          children: []
        })
      ]
    });

    await expect(resolveMcpProxies(root, { projectRoot: "/repo" })).rejects.toThrow(
      "upstream unavailable"
    );
    await expect(mockFsPromises.readFile(cachePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft/src/__probe__.test.ts` afterward.

## Observed Behavior

- The probe begins with a valid cache at `/repo/.toolcraft/mcp/github.json` containing a discoverable cached tool.
- With `TOOLCRAFT_MCP_REFRESH=github`, `resolveMcpProxies()` attempts a forced refresh and rejects when the mocked MCP client cannot connect upstream.
- After that rejected refresh, reading the previously valid cache path fails with `ENOENT`; the cache has been irreversibly deleted despite no replacement being fetched.
- In `packages/toolcraft/src/mcp-proxy.ts`, `resolveSingleProxy()` calls `deleteCacheIfPresent(cachePath)` before `fetchCache(...)` on the refresh path, so any failure in discovery or persistence occurs after destruction of the fallback cache.

## Expected Behavior

A forced refresh should retain the previous valid cache unless and until a replacement has been fetched and committed successfully. If refresh fails, future non-refresh resolutions should still be able to use the last known good cache.

## Impact

A temporary MCP server outage, authentication failure, or connectivity issue during explicit cache refresh converts a recoverable stale-cache condition into loss of all cached tool discovery for that server. Subsequent invocations cannot load known tools from disk and must depend on upstream availability again, degrading CLI and SDK reliability precisely during an outage.
