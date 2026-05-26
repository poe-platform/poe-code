# Tiny MCP client null server capabilities enters ready but rejects operations

## Summary

The exported `tiny-mcp-client` `McpClient.connect()` method accepts an `initialize` response whose required `capabilities` object is `null`. It then transitions to `state === "ready"` while storing `serverCapabilities === null`, the same sentinel used for an uninitialized client, so capability-dependent operations reject by claiming initialization never completed.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { McpClient, type McpTransport } from "./internal.js";

describe("malformed negotiated capabilities", () => {
  it("reports ready after accepting null capabilities, then treats itself as uninitialized", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise<never>(() => undefined),
      dispose: () => undefined
    };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });

    writable.once("data", () => {
      readable.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: null,
          serverInfo: { name: "server", version: "1" }
        }
      })}\n`);
    });

    await expect(client.connect(transport)).resolves.toMatchObject({ capabilities: null });
    expect(client.state).toBe("ready");
    expect(client.serverCapabilities).toBeNull();
    await expect(client.listTools()).rejects.toThrow("MCP client has not completed initialization");

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
✓ packages/tiny-mcp-client/src/__probe__.test.ts > malformed negotiated capabilities > reports ready after accepting null capabilities, then treats itself as uninitialized
```

`McpClient` types successful initialization as requiring `capabilities: ServerCapabilities` at `packages/tiny-mcp-client/src/internal.ts:87` through `packages/tiny-mcp-client/src/internal.ts:97`, but `connect()` casts the untrusted response to that type and validates only `protocolVersion` at `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:356`. The malformed `null` value is assigned to `currentServerCapabilities`, then the client reports ready. Subsequent operations call `getServerCapabilitiesOrThrow()` at `packages/tiny-mcp-client/src/internal.ts:359` through `packages/tiny-mcp-client/src/internal.ts:365`, which interprets `null` as “has not completed initialization” and rejects `listTools()` despite the public ready state.

## Expected Behavior

`McpClient.connect()` should reject an `initialize` response unless `capabilities` is a valid object conforming to the negotiated server-capability shape. It should not resolve and transition to `ready` with the same internal value reserved for incomplete initialization.

## Impact

A malformed or compromised MCP server can make a client report successful connection while immediately failing normal operations with a contradictory local initialization error. Callers may display the server as ready, discard reconnection or fallback logic, and then receive misleading operation failures whose actual cause was an invalid handshake payload accepted earlier.
