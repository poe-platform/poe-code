# Toolcraft MCP snake case parameter collision drops declared input

## Summary

The public `toolcraft/mcp` adapter silently collapses distinct command parameters that normalize to the same snake-case MCP key. A command declaring both `fooBar` and `foo_bar` is advertised with only one usable input field, and a successful tool call delivers only the latter parameter to the handler even though both were required by the source schema.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";

import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe("MCP parameter casing collision", () => {
  it("advertises and dispatches only one of two parameters sharing a snake-case wire name", async () => {
    const observed: unknown[] = [];
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "submit",
            scope: ["mcp"],
            params: S.Object({
              fooBar: S.String(),
              foo_bar: S.String()
            }),
            async handler({ params }) {
              observed.push(params);
              return params;
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
      const submit = tools.tools.find((tool) => tool.name === "submit");
      expect(submit?.inputSchema).toMatchObject({
        properties: { foo_bar: { type: "string" } },
        required: ["foo_bar", "foo_bar"]
      });

      await client.callTool({ name: "submit", arguments: { foo_bar: "only-one-value" } });
      expect(observed).toEqual([{ foo_bar: "only-one-value" }]);
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
✓ packages/toolcraft/src/__probe__.test.ts > MCP parameter casing collision > advertises and dispatches only one of two parameters sharing a snake-case wire name
```

With the default MCP casing, `formatSegment()` converts both source names to `foo_bar` at `packages/toolcraft/src/mcp.ts:162` through `packages/toolcraft/src/mcp.ts:172`. Schema publication rebuilds properties with `Object.fromEntries()` at `packages/toolcraft/src/mcp.ts:229` through `packages/toolcraft/src/mcp.ts:253`, so one `foo_bar` property overwrites the other while the required array contains the duplicate wire name. Runtime argument mapping repeats the collision in a `Map` at `packages/toolcraft/src/mcp.ts:522` through `packages/toolcraft/src/mcp.ts:583`, and the one submitted wire value is dispatched only as `{ foo_bar: "only-one-value" }`, omitting required `fooBar` entirely.

## Expected Behavior

MCP registration should reject source parameter schemas whose configured casing would produce duplicate wire keys, or encode them without collision. A successful tool invocation must not omit a declared required parameter because its display name collides with another field during casing conversion.

## Impact

Tools wrapping existing SDKs or external APIs can publish an incomplete MCP contract and execute handlers with missing required data whenever distinct field names normalize identically. Agents see only one representable input, while handler logic may perform actions with silently omitted arguments or apply incorrect defaults under an apparently valid successful call.
