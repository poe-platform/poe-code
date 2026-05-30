---
name: "Toolcraft MCP proxy invalid discovery is cached and suppresses healthy refetch"
---

# Toolcraft MCP proxy invalid discovery is cached and suppresses healthy refetch

## Summary

`toolcraft` writes newly discovered MCP tools to its persistent proxy cache before it validates whether those tools can be converted into executable Toolcraft commands. If an upstream response includes an invalid tool schema, the initial resolution rejects but the invalid manifest remains cached. Later normal resolutions load that cache instead of contacting an upstream server that has already recovered, repeatedly failing on the persisted invalid tool until the cache is manually refreshed or removed.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFsFromVolume, vol } from "memfs";
import { defineGroup } from "./index.js";

const mockFsPromises = createFsFromVolume(vol).promises;
let connections = 0;

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
    serverInfo = { name: "upstream", version: "1" };
    async connect() {
      connections += 1;
      return { capabilities: { tools: {} }, protocolVersion: "2024-11-05", serverInfo: this.serverInfo };
    }
    async listTools() {
      return {
        tools:
          connections === 1
            ? [{ name: "bad_tool", inputSchema: { type: "string" } }]
            : [{ name: "good_tool", inputSchema: { type: "object", properties: {} } }]
      };
    }
    async close() {}
  },
  StdioTransport: class MockStdioTransport {},
  HttpTransport: class MockHttpTransport {}
}));

const { resolveMcpProxies } = await import("./mcp-proxy.js");
function root() {
  return defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "github",
        mcp: { transport: "stdio", command: "mock" },
        children: []
      })
    ]
  });
}

describe("MCP proxy invalid-discovery cache probe", () => {
  it("persists invalid tools and then refuses to retry a healthy upstream", async () => {
    vol.reset();
    connections = 0;
    vol.fromJSON({ "/repo/package.json": JSON.stringify({ name: "repo" }) });

    await expect(resolveMcpProxies(root(), { projectRoot: "/repo" })).rejects.toThrow(
      'upstream tool "bad_tool" must define an object input schema'
    );
    expect(await mockFsPromises.readFile("/repo/.toolcraft/mcp/github.json", "utf8")).toContain(
      "bad_tool"
    );

    await expect(resolveMcpProxies(root(), { projectRoot: "/repo" })).rejects.toThrow(
      'upstream tool "bad_tool" must define an object input schema'
    );
    expect(connections).toBe(1);
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft/src/__probe__.test.ts` afterward.

## Observed Behavior

- On the first resolution, the mocked upstream supplies `bad_tool` with a non-object `inputSchema`; `resolveMcpProxies()` rejects while converting it into a command.
- Despite the rejected resolution, `/repo/.toolcraft/mcp/github.json` is created and contains `bad_tool`.
- The mocked upstream would supply a valid `good_tool` on its second connection, but a second normal `resolveMcpProxies()` invocation rejects on cached `bad_tool` and never opens that second connection (`connections` remains `1`).
- In `packages/toolcraft/src/mcp-proxy.ts`, `fetchCache()` calls `writeCache()` immediately after listing upstream tools; command filtering, rename validation, and schema conversion in `populateGroupFromTools()` occur only after the cached manifest has been returned to `resolveSingleProxy()`.

## Expected Behavior

A newly discovered manifest should be persisted as a reusable cache only after the complete tool set has passed the same validation required for successful proxy resolution. A failed initial discovery should not make future normal starts replay an invalid cached manifest instead of retrying an available upstream.

## Impact

One transient malformed upstream response or incompatible tool schema can poison a project's persistent MCP cache and turn a recoverable server-side correction into repeated local startup failures. Users must discover the cache problem and force-refresh or delete it manually before healthy tools become available again.
