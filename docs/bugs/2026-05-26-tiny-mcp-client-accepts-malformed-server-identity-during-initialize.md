# Tiny MCP client accepts malformed server identity during initialize

## Summary

The exported `tiny-mcp-client` `McpClient.connect()` API accepts an `initialize` response whose required `serverInfo.version` value is a number rather than a string. The client resolves initialization, reports `state === "ready"`, and exposes the malformed identity through both the returned typed `InitializeResult` and the public `serverInfo` getter.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { McpClient, type McpTransport } from "./internal.js";

describe("tiny-mcp-client malformed initialize identity", () => {
  it("enters ready state with a non-string server version", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const closed = new Promise<never>(() => undefined);
    const transport: McpTransport = { readable, writable, closed, close: async () => undefined };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });

    writable.once("data", () => {
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "server", version: 7 }
          }
        })}\n`
      );
    });

    const result = await client.connect(transport);

    expect(client.state).toBe("ready");
    expect(result.serverInfo).toEqual({ name: "server", version: 7 });
    expect(client.serverInfo).toEqual({ name: "server", version: 7 });

    readable.destroy();
    writable.destroy();
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-mcp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-mcp-client/src/__probe__.test.ts > tiny-mcp-client malformed initialize identity > enters ready state with a non-string server version
```

## Observed Behavior

The public `InitializeResult` type requires `serverInfo: Implementation`, and `Implementation.version` is declared as `string` in `packages/tiny-mcp-client/src/internal.ts:45` through `packages/tiny-mcp-client/src/internal.ts:48` and `packages/tiny-mcp-client/src/internal.ts:91` through `packages/tiny-mcp-client/src/internal.ts:96`. However, `connect()` casts the untrusted JSON-RPC response directly to `InitializeResult`, validates only `protocolVersion`, stores `initializeResult.serverInfo` without validating its fields, and transitions to `ready` at `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:356`. In the probe, the server sends `{ name: "server", version: 7 }`, and the client exposes that numeric version as a successful negotiated identity.

## Expected Behavior

`McpClient.connect()` should reject an initialize response unless required handshake fields conform to their runtime contract, including a `serverInfo` object with non-empty string `name` and `version` values. It should not enter `ready` state or publish typed server identity metadata when the remote peer supplied malformed identity fields.

## Impact

Applications can trust `client.serverInfo` and the resolved `InitializeResult` as validated string metadata for logging, diagnostics, allowlisting, compatibility selection, UI rendering, or telemetry labels. A malformed or compromised MCP server can instead inject type-invalid identity data through a successful handshake, deferring protocol validation failures into downstream code after the client has already treated the connection as operational.
