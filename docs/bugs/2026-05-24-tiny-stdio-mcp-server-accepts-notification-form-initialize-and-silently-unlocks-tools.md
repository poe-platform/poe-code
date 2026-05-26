# Tiny stdio MCP server accepts notification-form initialize and silently unlocks tools

## Summary

`tiny-stdio-mcp-server` treats an id-less JSON-RPC `initialize` message as a successful initialization request even though it is a notification and the server cannot return the negotiated initialization result. After silently consuming that invalid notification, the same stdio connection can execute normal MCP methods such as `tools/list` without ever completing an `initialize` response exchange or sending `notifications/initialized`.

## Reproduction

From the repository root, run a disposable Vitest probe that writes notification-form `initialize` followed by an ordinary tools request over the public stdio transport:

```sh
cat > /tmp/tiny-stdio-mcp-initialize-notification-wire-probe.test.ts <<'PROBE'
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("tiny stdio MCP initialize notification wire handling", () => {
  it("allows tools after an id-less initialize notification without replying to initialization", async () => {
    const output: string[] = [];
    const readable = new Readable({ read() {} });
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const server = createServer({ name: "probe", version: "1" });
    const connection = server.connect({ readable, writable });

    readable.push('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n');
    readable.push('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    readable.push(null);
    await connection;

    const responses = output.map((line) => JSON.parse(line.trim()));
    console.log(JSON.stringify({ responses }));
    expect(responses).toEqual([{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-initialize-notification-wire-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The initialization notification receives no response, but it changes server state sufficiently for the subsequent `tools/list` request to succeed:

```text
{"responses":[{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}]}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP initialize notification wire handling > allows tools after an id-less initialize notification without replying to initialization
```

`packages/tiny-stdio-mcp-server/src/jsonrpc.ts:77` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:86` classifies any method-bearing id-less message, including `initialize`, as a notification. `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:84` then immediately sets the shared `initialized` flag whenever the method name is `initialize`. Finally, `packages/tiny-stdio-mcp-server/src/server.ts:181` through `packages/tiny-stdio-mcp-server/src/server.ts:188` suppress the produced initialization result solely because the original message was parsed as a notification.

## Expected Behavior

`initialize` must be a request whose successful result is returned to the client before ordinary MCP operations are enabled. An id-less `initialize` notification should be rejected or ignored without advancing initialization state or unlocking `tools/list`.

## Impact

A malformed or malicious stdio client can bypass the initialization result exchange and transition the server into its operational state without receiving negotiated protocol version or capabilities. This weakens lifecycle enforcement and permits tool discovery or calls on a connection that never completed the required handshake.
