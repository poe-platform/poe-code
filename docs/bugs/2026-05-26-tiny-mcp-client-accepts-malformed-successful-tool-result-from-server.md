# Tiny MCP client accepts malformed successful tool result from server

## Summary

The exported `tiny-mcp-client` `McpClient.callTool()` API promises a typed `CallToolResult`, but it returns any successful JSON-RPC `tools/call` result from the server without validating its MCP content items. A malformed remote server can return a text content block with no required `text` value, and the client resolves that invalid payload as a successful typed result.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-mcp-client/src/__probe__.test.ts <<'EOF'
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { McpClient, type McpTransport } from "./internal.js";

async function readLine(stream: PassThrough): Promise<string> {
  return await new Promise((resolve) => {
    stream.once("data", (chunk) => resolve(String(chunk)));
  });
}

describe("tiny-mcp-client malformed callTool success", () => {
  it("resolves an invalid successful tool result from the wire", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });

    const connecting = client.connect(transport);
    const initialize = JSON.parse(await readLine(writable)) as { id: number };
    readable.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: initialize.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "malformed", version: "1" },
      },
    })}\n`);
    await connecting;
    await readLine(writable);

    const calling = client.callTool({ name: "bad", arguments: {} });
    const request = JSON.parse(await readLine(writable)) as { id: number };
    readable.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text" }] },
    })}\n`);

    await expect(calling).resolves.toEqual({ content: [{ type: "text" }] });
  });
});
EOF
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-mcp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-mcp-client/src/__probe__.test.ts > tiny-mcp-client malformed callTool success > resolves an invalid successful tool result from the wire
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

After normal initialization, the fake server returns a successful `tools/call` response containing `{ content: [{ type: "text" }] }`. The content item omits the mandatory text payload, but `client.callTool()` resolves successfully with the malformed object unchanged.

The public content type requires `TextContent.text: string` and `CallToolResult.content: ContentItem[]` in `packages/tiny-mcp-client/src/internal.ts:644` and `packages/tiny-mcp-client/src/internal.ts:695`. At runtime, `callTool()` casts the unvalidated JSON-RPC response promise directly to `Promise<CallToolResult>` and returns it at `packages/tiny-mcp-client/src/internal.ts:381` through `packages/tiny-mcp-client/src/internal.ts:432`; it performs no result-shape validation.

## Expected Behavior

`McpClient.callTool()` should reject malformed successful responses from remote servers rather than returning values that violate its exported MCP result types. In particular, a text content item without a string `text` field should be treated as invalid protocol data.

## Impact

Applications using `tiny-mcp-client` may trust a successful `CallToolResult` and immediately render, log, store, or act on its content fields. A malformed or compromised MCP server can inject invalid tool content through a nominally successful call, shifting protocol-validation failures into downstream application code and causing crashes, incorrect displays, or silently incomplete tool output.
