---
name: "Toolcraft MCP proxy failed repopulation drops working tools and leaves partial replacements"
---

# Toolcraft MCP proxy failed repopulation drops working tools and leaves partial replacements

## Summary

`toolcraft` mutates an already-resolved MCP proxy group's live `children` array while building its replacement command tree. `populateGroupFromTools()` first removes every existing proxy-generated child, then appends each newly discovered command sequentially. If a later discovered tool has an invalid schema and command creation throws, `resolveMcpProxies()` rejects after the prior working tool set has already been removed and an incomplete prefix of the replacement set remains installed in the live group.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
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
  McpClient: class MockMcpClient {},
  StdioTransport: class MockStdioTransport {},
  HttpTransport: class MockHttpTransport {}
}));

const { resolveMcpProxies } = await import("./mcp-proxy.js");
const cachePath = "/repo/.toolcraft/mcp/github.json";
function cache(tools: Array<Record<string, unknown>>) {
  return JSON.stringify({
    $schema: "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
    version: 1,
    fetchedAt: "2026-05-25T00:00:00.000Z",
    upstream: { name: "cached", version: "1.0.0" },
    tools
  });
}

describe("MCP proxy failed repopulation probe", () => {
  it("drops previously working tools and leaves partial replacements after rejection", async () => {
    vol.reset();
    vol.fromJSON({
      "/repo/package.json": JSON.stringify({ name: "repo" }),
      [cachePath]: cache([{ name: "old_tool", inputSchema: { type: "object", properties: {} } }])
    });
    const group = defineGroup({
      name: "github",
      mcp: { transport: "stdio", command: "mock" },
      children: []
    });
    const root = defineGroup({ name: "root", children: [group] });
    const proxyGroup = root.children[0];
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    await resolveMcpProxies(root, { projectRoot: "/repo" });
    expect(proxyGroup.children.map((child) => child.name)).toEqual(["old_tool"]);

    await mockFsPromises.writeFile(
      cachePath,
      cache([
        { name: "new_tool", inputSchema: { type: "object", properties: {} } },
        { name: "bad_tool", inputSchema: { type: "string" } }
      ])
    );

    await expect(resolveMcpProxies(root, { projectRoot: "/repo" })).rejects.toThrow(
      'upstream tool "bad_tool" must define an object input schema'
    );
    expect(proxyGroup.children.map((child) => child.name)).toEqual(["new_tool"]);
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft/src/__probe__.test.ts` afterward.

## Observed Behavior

- The first resolution loads a valid cached `old_tool` and installs it in the live proxy group.
- The cache is replaced with a two-tool manifest where `new_tool` is valid and the later `bad_tool` has a non-object input schema.
- The second `resolveMcpProxies()` rejects while converting `bad_tool`, but the live group no longer contains `old_tool`; it contains only the prematurely installed `new_tool`.
- In `packages/toolcraft/src/mcp-proxy.ts`, `populateGroupFromTools()` calls `removeProxyChildren(group)` before iterating tools and pushing new command nodes; the outer catch disposes the candidate connection but does not restore `group.children` after construction fails.

## Expected Behavior

A failed MCP proxy re-resolution should leave the previously usable command tree intact. Replacement commands should be constructed and validated off to the side, then swapped into the live group only after the entire discovered tool set has been accepted successfully.

## Impact

A malformed newly cached or newly discovered tool can make an already-running CLI or SDK root lose stable working MCP commands while exposing only a partial new command set, even though the update reports failure. Callers can observe missing or inconsistent tools until the process is rebuilt or resolution succeeds again.
