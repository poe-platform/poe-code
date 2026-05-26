# Toolcraft MCP proxy reuses old tools after upstream configuration changes

## Summary

`toolcraft` stores MCP proxy tool manifests under a cache filename derived only from the proxy group name. It does not bind a cached manifest to the currently configured transport, command, URL, headers, arguments, or environment. If a project changes the server configured for an existing group such as `github`, normal proxy resolution loads the previous server's cached tool list and never contacts the newly configured upstream. The new connection configuration is paired with an old server's command surface.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFsFromVolume, vol } from "memfs";
import { defineGroup } from "./index.js";

const mockFsPromises = createFsFromVolume(vol).promises;
const transports: string[] = [];

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
    async connect() { throw new Error("replacement upstream should not be contacted"); }
  },
  StdioTransport: class MockStdioTransport {
    constructor(options: { command: string }) { transports.push(options.command); }
  },
  HttpTransport: class MockHttpTransport {}
}));

const { resolveMcpProxies } = await import("./mcp-proxy.js");

describe("MCP proxy stale upstream cache probe", () => {
  it("reuses old tools after the server command changes", async () => {
    vol.reset();
    transports.length = 0;
    vol.fromJSON({
      "/repo/package.json": JSON.stringify({ name: "repo" }),
      "/repo/.toolcraft/mcp/github.json": JSON.stringify({
        $schema: "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
        version: 1,
        fetchedAt: "2026-05-25T00:00:00.000Z",
        upstream: { name: "old-server", version: "1" },
        tools: [{ name: "old_tool", inputSchema: { type: "object", properties: {} } }]
      })
    });
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "github",
          mcp: { transport: "stdio", command: "replacement-server" },
          children: []
        })
      ]
    });
    const proxyGroup = root.children[0];
    if (proxyGroup?.kind !== "group") throw new Error("Expected proxy group.");

    await resolveMcpProxies(root, { projectRoot: "/repo" });
    expect(proxyGroup.children.map((child) => child.name)).toEqual(["old_tool"]);
    expect(transports).toEqual([]);
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft/src/__probe__.test.ts` afterward.

## Observed Behavior

- A valid existing cache for group `github` advertises `old_tool` from `old-server`.
- The live Toolcraft definition configures the same group name to use a different stdio command, `replacement-server`.
- `resolveMcpProxies()` succeeds and exposes `old_tool` from the prior server cache.
- The mocked replacement transport is never even constructed, proving the new configured server is not contacted before old tools are accepted.
- In `packages/toolcraft/src/mcp-proxy.ts`, `resolveCachePath(name, projectRoot)` maps all configurations for one group name to `.toolcraft/mcp/<name>.json`, while `readCache()` validates only manifest shape and upstream informational strings, not correspondence to the active `McpServerConfig`.

## Expected Behavior

A proxy cache should be valid only for the upstream configuration that produced it, or configuration changes should automatically invalidate and refetch the cache. Normal resolution must not present tools from one server while routing later executions to a different newly configured server.

## Impact

Changing an MCP server endpoint or executable can leave users with a stale command surface from the prior server without any warning. Commands may be missing, mislabeled, or invoked against an incompatible replacement server, creating confusing execution failures and potentially exposing functionality that operators believed was no longer configured.
