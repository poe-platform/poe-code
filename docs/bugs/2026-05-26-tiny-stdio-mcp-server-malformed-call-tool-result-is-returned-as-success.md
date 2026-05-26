# Tiny stdio MCP server malformed call-tool result is returned as success

## Summary

The public `tiny-stdio-mcp-server` tool handler contract requires `CallToolResult.content` to contain valid MCP content items, but runtime handling identifies a direct result solely by the presence of an array-valued `content` field. A tool can therefore return `{ content: [{ type: "text" }] }` without the required `text` payload and the server reports it as a successful tool result.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createServer, defineSchema } from "./index.js";

describe("tiny-stdio malformed CallToolResult passthrough", () => {
  it("returns a successful text block without required text content", async () => {
    const server = createServer({ name: "probe", version: "1.0.0" }).tool(
      "malformed",
      "malformed",
      defineSchema({}),
      async () => ({ content: [{ type: "text" }] } as never)
    );

    await server.handleMessage("initialize", {});

    await expect(
      server.handleMessage("tools/call", { name: "malformed", arguments: {} })
    ).resolves.toEqual({
      result: { content: [{ type: "text" }] }
    });
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio malformed CallToolResult passthrough > returns a successful text block without required text content
```

## Observed Behavior

The exported `CallToolResult` and `ContentItem` types require text blocks to include `text: string` at `packages/tiny-stdio-mcp-server/src/types.ts:63` through `packages/tiny-stdio-mcp-server/src/types.ts:83`, and the handler type permits tools to return that shape at `packages/tiny-stdio-mcp-server/src/types.ts:102` through `packages/tiny-stdio-mcp-server/src/types.ts:110`. At runtime, `createServer()` uses `isCallToolResult()` to decide whether to pass a handler return value directly through to clients at `packages/tiny-stdio-mcp-server/src/server.ts:136` through `packages/tiny-stdio-mcp-server/src/server.ts:141`. That predicate checks only that `content` is an array at `packages/tiny-stdio-mcp-server/src/server.ts:330` through `packages/tiny-stdio-mcp-server/src/server.ts:336`; it never validates any content item fields. A handler returning a text item with no `text` property is therefore accepted and returned as a successful tool result.

## Expected Behavior

Tool results supplied through the public server API should be validated before being exposed as successful MCP output. A malformed content item should reject the tool invocation or be converted into a controlled tool error, rather than being passed through as though it satisfied the documented `ContentItem` protocol shape.

## Impact

Incorrect or adversarial tool integrations can emit successful MCP responses that clients cannot render or interpret according to the protocol. Because the server marks the call as successful, downstream clients and agents may treat missing content as valid tool output, hide integration bugs, or fail later with less actionable errors.
