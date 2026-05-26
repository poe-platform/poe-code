# Tiny MCP client null tools capability authorizes tool requests

## Summary

The exported `tiny-mcp-client` accepts a malformed server initialization capability entry of `tools: null` and treats it as proof that the server supports tool operations. After the malformed handshake, `client.listTools()` sends a `tools/list` request instead of rejecting locally because a valid tools capability object was never negotiated.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { McpClient, type McpTransport } from "./internal.js";

describe("malformed tools capability", () => {
  it("authorizes tools/list when the server advertises tools as null", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise<never>(() => undefined),
      dispose: () => undefined
    };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });
    let requestCount = 0;

    writable.on("data", () => {
      requestCount += 1;
      if (requestCount === 1) {
        readable.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: null },
            serverInfo: { name: "server", version: "1" }
          }
        })}\n`);
        return;
      }
      if (requestCount === 3) {
        readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } })}\n`);
      }
    });

    await client.connect(transport);
    await expect(client.listTools()).resolves.toEqual({ tools: [] });
    expect(client.serverCapabilities).toEqual({ tools: null });

    readable.destroy();
    writable.destroy();
  });
});
```

Run it and remove the probe:

```sh
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-mcp-client/src/__probe__.test.ts
```

## Observed Behavior

The disposable probe passes:

```text
✓ packages/tiny-mcp-client/src/__probe__.test.ts > malformed tools capability > authorizes tools/list when the server advertises tools as null
```

`ServerCapabilities` declares `tools` as an optional object at `packages/tiny-mcp-client/src/internal.ts:62` through `packages/tiny-mcp-client/src/internal.ts:83`, but `connect()` stores the untrusted initialization value without runtime validation at `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:356`. `listTools()` then blocks only when `serverCapabilities.tools === undefined` at `packages/tiny-mcp-client/src/internal.ts:367` through `packages/tiny-mcp-client/src/internal.ts:378`; malformed `null` is considered present and authorizes an outgoing `tools/list` request.

## Expected Behavior

The client should reject an initialize response whose `capabilities.tools` value is not a valid capability object, or at minimum treat such a malformed value as absent and refuse tool requests. Optional feature access must not be enabled by type-invalid negotiation data.

## Impact

A malformed or adversarial server can induce protocol requests for features it did not validly advertise. Client code that relies on negotiated capabilities for compatibility and safety instead dispatches tool traffic after accepting corrupted handshake metadata, producing misleading successes or unexpected server-side behavior.
