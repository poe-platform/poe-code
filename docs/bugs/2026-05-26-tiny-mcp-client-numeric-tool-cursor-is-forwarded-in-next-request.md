# Tiny MCP client numeric tool cursor is forwarded in next request

## Summary

The exported `tiny-mcp-client` `listTools()` API trusts the server's pagination result without validating that `nextCursor` is a string. A malformed server can return `nextCursor: 7`; the typed client publishes that numeric cursor, and ordinary pagination code forwards it in the next `tools/list` request as `params.cursor: 7`.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { McpClient, type McpTransport } from "./internal.js";

describe("malformed tools pagination cursor", () => {
  it("returns a numeric nextCursor that callers forward in a later tool request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise<never>(() => undefined),
      dispose: () => undefined
    };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });
    const requests: Array<Record<string, unknown>> = [];

    writable.on("data", (data) => {
      const request = JSON.parse(data.toString()) as Record<string, unknown>;
      requests.push(request);
      if (requests.length === 1) {
        readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {
          protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "server", version: "1" }
        } })}\n`);
      } else if (requests.length === 3) {
        readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [], nextCursor: 7 } })}\n`);
      } else if (requests.length === 4) {
        readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, result: { tools: [] } })}\n`);
      }
    });

    await client.connect(transport);
    const firstPage = await client.listTools();
    await client.listTools({ cursor: firstPage.nextCursor as never });

    expect(firstPage.nextCursor).toBe(7);
    expect(requests[3]).toMatchObject({ params: { cursor: 7 } });
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
✓ packages/tiny-mcp-client/src/__probe__.test.ts > malformed tools pagination cursor > returns a numeric nextCursor that callers forward in a later tool request
```

`PaginatedParams.cursor` and the `listTools()` return value declare cursors as strings at `packages/tiny-mcp-client/src/internal.ts:622` through `packages/tiny-mcp-client/src/internal.ts:628` and `packages/tiny-mcp-client/src/internal.ts:367` through `packages/tiny-mcp-client/src/internal.ts:378`. At runtime, however, `listTools()` casts the untrusted server response directly to its typed result without checking `nextCursor`. When the returned numeric value is passed to the next page call, the request builder copies it into `params.cursor` unchanged at `packages/tiny-mcp-client/src/internal.ts:374` through `packages/tiny-mcp-client/src/internal.ts:378`.

## Expected Behavior

The client should validate each server-supplied pagination cursor before returning it through the typed API. A non-string `nextCursor` should reject the response or be treated as absent; it should never be surfaced and subsequently emitted as an invalid typed cursor parameter.

## Impact

Pagination loops can be corrupted by malformed or malicious server responses: callers following the package's normal pagination pattern transmit invalid cursor types back to the server, potentially causing failures, inconsistent result traversal, or misleading missing-page behavior after a connection that otherwise appears healthy.
