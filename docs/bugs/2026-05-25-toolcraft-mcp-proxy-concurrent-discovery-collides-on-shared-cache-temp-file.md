---
name: "Toolcraft MCP proxy concurrent discovery collides on shared cache temp file"
---

# Toolcraft MCP proxy concurrent discovery collides on shared cache temp file

## Summary

`toolcraft`'s MCP proxy cache writer always stages a cache replacement through the fixed sibling path `<cache>.tmp`. Two concurrent `resolveMcpProxies()` calls for the same group and project root can both complete upstream discovery successfully, then race while committing their caches: one call renames the shared temp file into place, and the other later fails because its own expected temp file has already been consumed. Normal parallel initialization therefore reports an MCP discovery failure even though both upstream requests succeeded.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFsFromVolume, vol } from "memfs";
import { defineGroup } from "./index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const rawFsPromises = createFsFromVolume(vol).promises;
const firstRenameEntered = deferred();
const releaseFirstRename = deferred();
let cacheRenames = 0;
const mockFsPromises = {
  ...rawFsPromises,
  rename: async (fromPath: string, toPath: string) => {
    if (fromPath.endsWith("github.json.tmp") && toPath.endsWith("github.json")) {
      cacheRenames += 1;
      if (cacheRenames === 1) {
        firstRenameEntered.resolve();
        await releaseFirstRename.promise;
      } else {
        await rawFsPromises.rename(fromPath, toPath);
        releaseFirstRename.resolve();
        return;
      }
    }
    await rawFsPromises.rename(fromPath, toPath);
  }
};
let nextTool = 0;

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
    readonly toolName = ++nextTool === 1 ? "from_first" : "from_second";
    serverInfo = { name: "upstream", version: "1" };
    async connect() {
      return { capabilities: { tools: {} }, protocolVersion: "2024-11-05", serverInfo: this.serverInfo };
    }
    async listTools() {
      return { tools: [{ name: this.toolName, inputSchema: { type: "object", properties: {} } }] };
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

describe("parallel MCP proxy cache writes probe", () => {
  it("fails one successful discovery when both writers share the temp path", async () => {
    vol.reset();
    vol.fromJSON({ "/repo/package.json": JSON.stringify({ name: "repo" }) });
    const first = resolveMcpProxies(root(), { projectRoot: "/repo" });
    await firstRenameEntered.promise;
    const second = resolveMcpProxies(root(), { projectRoot: "/repo" });

    await expect(second).resolves.toBeUndefined();
    await expect(first).rejects.toThrow("rename '/repo/.toolcraft/mcp/github.json.tmp'");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft/src/__probe__.test.ts` afterward.

## Observed Behavior

- Both mocked MCP clients connect and successfully return tool discovery responses for the same `github` proxy group.
- The first invocation pauses after writing the common `/repo/.toolcraft/mcp/github.json.tmp`; the second invocation writes and renames that same temp path to the final cache.
- When the first invocation resumes its commit, `resolveMcpProxies()` rejects with a wrapped rename error because `/repo/.toolcraft/mcp/github.json.tmp` no longer exists.
- `packages/toolcraft/src/mcp-proxy.ts` defines `const tempPath = `${cachePath}.tmp`` in `writeCache()` without unique writer identity or serialization, so independent discovery callers share the same staging resource.

## Expected Behavior

Two concurrent successful proxy discoveries targeting one cache should not make either public resolution fail solely due to cache persistence. Cache writes should be serialized or staged through per-writer temporary files so each successful discovery can complete without consuming another invocation's pending rename input.

## Impact

Parallel CLI/SDK initialization, concurrent commands in one project, or overlapping warm-up and runtime resolution can spuriously report that an MCP proxy could not be discovered even while the upstream server is healthy. This introduces nondeterministic startup failures and can prevent otherwise available tools from being exposed to one caller.
