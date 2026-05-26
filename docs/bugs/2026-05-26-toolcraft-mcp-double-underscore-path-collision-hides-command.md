# Toolcraft MCP double underscore path collision hides command

## Summary

The public `toolcraft/mcp` adapter uses `__` as an unescaped separator between command-path segments. A flat MCP-scoped command named `admin__reset` therefore collides with a nested `admin.reset` command, and clients are exposed only one `admin__reset` tool whose invocation reaches the later nested implementation; the flat command becomes inaccessible.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";

import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe("MCP tool path separator collision", () => {
  it("hides a flat double-underscore command behind a nested command path", async () => {
    const called: string[] = [];
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "admin__reset",
            scope: ["mcp"],
            params: S.Object({}),
            async handler() {
              called.push("flat");
              return "flat";
            }
          }),
          defineGroup({
            name: "admin",
            children: [
              defineCommand({
                name: "reset",
                scope: ["mcp"],
                params: S.Object({}),
                async handler() {
                  called.push("nested");
                  return "nested";
                }
              })
            ]
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
      expect(tools.tools.map((tool) => tool.name).filter((name) => name === "admin__reset")).toEqual(["admin__reset"]);
      const result = await client.callTool({ name: "admin__reset", arguments: {} });
      expect(result).toMatchObject({ content: [{ type: "text", text: "nested" }] });
      expect(called).toEqual(["nested"]);
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
✓ packages/toolcraft/src/__probe__.test.ts > MCP tool path separator collision > hides a flat double-underscore command behind a nested command path
```

`formatToolName()` constructs every MCP name by joining normalized path segments with the literal delimiter `__` at `packages/toolcraft/src/mcp.ts:309` through `packages/toolcraft/src/mcp.ts:311`. `enumerateTools()` therefore derives the identical exposed name `admin__reset` for both the one-segment flat command and the two-segment nested path at `packages/toolcraft/src/mcp.ts:313` through `packages/toolcraft/src/mcp.ts:366`. When these tool definitions are registered at `packages/toolcraft/src/mcp.ts:663` through `packages/toolcraft/src/mcp.ts:708`, clients list only one tool under that name and calling it reaches only the nested handler.

## Expected Behavior

MCP tool-name encoding should escape or reject command-path segments containing its separator so distinct paths remain distinct, and server registration should diagnose collisions rather than silently hiding an operation. Both valid declared commands must remain independently addressable or be rejected clearly at definition time.

## Impact

Tool trees wrapping external APIs can silently lose flat operations whose source names contain double underscores whenever another nested command maps to the same MCP spelling. Agents see an incomplete or misleading tool surface and may execute the nested operation while intending to call a distinct flat command.
