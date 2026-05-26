# Tiny stdio MCP server initialized connection unlocks second SDK client

## Summary

The exported `tiny-stdio-mcp-server` stores initialization state once on the server instance rather than separately for each SDK transport connection. When one client initializes a reusable server, a second concurrently connected SDK client can call initialized-only methods such as `tools/list` without sending its own `initialize` request.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./index.js";
import type { JSONRPCMessage, SDKTransport } from "./types.js";

function createTransport() {
  const sent: JSONRPCMessage[] = [];
  const transport = {
    onmessage: undefined,
    onclose: undefined,
    start: vi.fn(),
    send: vi.fn(async (message: JSONRPCMessage) => {
      sent.push(message);
    })
  } as unknown as SDKTransport;
  return { sent, transport };
}

describe("per-connection MCP initialization", () => {
  it("lets an uninitialized second SDK connection call tools after the first connects", async () => {
    const server = createServer({ name: "probe", version: "1" });
    const first = createTransport();
    const second = createTransport();

    void server.connectSDK(first.transport);
    void server.connectSDK(second.transport);

    await first.transport.onmessage!({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await second.transport.onmessage!({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    expect(second.sent).toEqual([
      { jsonrpc: "2.0", id: 2, result: { tools: [] } }
    ]);
  });
});
```

Run it and remove the probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

## Observed Behavior

The disposable probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > per-connection MCP initialization > lets an uninitialized second SDK connection call tools after the first connects
```

`createServer()` creates one `initialized` boolean in its shared closure at `packages/tiny-stdio-mcp-server/src/server.ts:50` through `packages/tiny-stdio-mcp-server/src/server.ts:56`. Handling any `initialize` message sets that flag at `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:84`, while later authorization of every other method consults the same flag at `packages/tiny-stdio-mcp-server/src/server.ts:91` through `packages/tiny-stdio-mcp-server/src/server.ts:99`. `connectSDK()` attaches multiple independent transports to that same handler at `packages/tiny-stdio-mcp-server/src/server.ts:276` through `packages/tiny-stdio-mcp-server/src/server.ts:324`. Thus the first SDK client initializing makes `tools/list` succeed on the second client before that second connection has performed any handshake.

## Expected Behavior

Initialization lifecycle state must be scoped to each connected client transport. An SDK connection that has not sent and completed its own `initialize` request should receive a not-initialized error for `tools/list` even if another connection to the same server instance is already ready.

## Impact

Servers reused for concurrent SDK clients lose lifecycle isolation: one client's handshake authorizes capabilities for other clients. Uninitialized peers can discover or invoke tools before protocol negotiation and client identification, and server behavior depends on unrelated connection timing rather than the requesting client's own state.
