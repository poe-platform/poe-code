# Toolcraft MCP snake case tool name collision hides command

## Summary

The public `toolcraft/mcp` adapter silently collapses distinct command names that normalize to the same snake-case MCP tool name. When a group contains commands named `runTask` and `run_task`, clients are advertised only one `run_task` tool, and invocations can reach only one implementation; the other valid command is inaccessible through MCP.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";

import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe("MCP tool name casing collision", () => {
  it("publishes one name for distinct commands and calls only one implementation", async () => {
    const called: string[] = [];
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "runTask",
            scope: ["mcp"],
            params: S.Object({}),
            async handler() {
              called.push("camel");
              return "camel";
            }
          }),
          defineCommand({
            name: "run_task",
            scope: ["mcp"],
            params: S.Object({}),
            async handler() {
              called.push("snake");
              return "snake";
            }
          })
        ]
      }),
      { name: "probe", version: "1.0.0", omitRootToolNamePrefix: true }
    );
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({ clientInfo: { name: "probe", version: "1.0.0" } })
    );

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).filter((name) => name === "run_task")).toEqual(["run_task"]);

      const result = await client.callTool({ name: "run_task", arguments: {} });
      expect(result).toMatchObject({ content: [{ type: "text", text: "snake" }] });
      expect(called).toEqual(["snake"]);
    } finally {
      await cleanup();
    }
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/toolcraft/src/__probe__.test.ts > MCP tool name casing collision > publishes one name for distinct commands and calls only one implementation
```

`formatToolName()` formats every path segment through snake casing at `packages/toolcraft/src/mcp.ts:309` through `packages/toolcraft/src/mcp.ts:311`, and `enumerateTools()` assigns that name to every MCP-exposed command at `packages/toolcraft/src/mcp.ts:313` through `packages/toolcraft/src/mcp.ts:366`. Consequently both commands are registered as `run_task`. During server registration at `packages/toolcraft/src/mcp.ts:663` through `packages/toolcraft/src/mcp.ts:708`, the later registration is the only implementation visible to the client: `tools/list` contains one `run_task`, and calling it executes only the `run_task` handler, never `runTask`.

## Expected Behavior

MCP registration should reject distinct command paths that normalize to the same exposed tool name, or use an unambiguous encoding that preserves both. A valid MCP-scoped command must not disappear merely because another command shares its normalized display name.

## Impact

Tool providers that expose existing SDK command trees can silently lose operations through MCP whenever names differ only by camel-case versus underscore styling. Agents see an incomplete command surface and may invoke the wrong operation under a misleading shared name, while server startup reports no configuration error.
