# Tiny stdio MCP server SDK notification send rejection is detached from notify success

## Summary

The exported `tiny-stdio-mcp-server` SDK transport connection registers notifications by launching `transport.send()` without awaiting or returning its promise. After initialization, `notifyToolsChanged()` therefore resolves successfully even when the active SDK transport rejects delivery of the advertised `notifications/tools/list_changed` notification.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./index.js";
import type { JSONRPCMessage, SDKTransport } from "./types.js";

describe("SDK tools-changed notification delivery", () => {
  it("reports success even when the connected transport rejects the notification send", async () => {
    const send = vi.fn(async (message: JSONRPCMessage) => {
      if ("method" in message && message.method === "notifications/tools/list_changed") {
        throw new Error("transport closed");
      }
    });
    const transport = {
      onmessage: undefined,
      onclose: undefined,
      start: vi.fn(),
      send
    } as unknown as SDKTransport;
    const server = createServer({ name: "probe", version: "1" });

    void server.connectSDK(transport);
    await transport.onmessage!({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    send.mockClear();

    await expect(server.notifyToolsChanged()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed"
    });
  });
});
```

Run it and remove the probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

## Observed Behavior

The probe passes even though the mocked SDK transport rejects the notification write:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > SDK tools-changed notification delivery > reports success even when the connected transport rejects the notification send
```

`notifyToolsChanged()` broadcasts synchronously at `packages/tiny-stdio-mcp-server/src/server.ts:240` through `packages/tiny-stdio-mcp-server/src/server.ts:243`. For SDK connections, the installed listener calls `void transport.send(notification)` at `packages/tiny-stdio-mcp-server/src/server.ts:276` through `packages/tiny-stdio-mcp-server/src/server.ts:280`, detaching the returned delivery promise. In the reproduction, `transport.send()` is reached with the list-changed notification and rejects with `Error("transport closed")`, while the public `await server.notifyToolsChanged()` operation still fulfills.

## Expected Behavior

When `notifyToolsChanged()` is invoked for an initialized SDK connection, rejection from the transport operation responsible for delivering that notification should be propagated to the caller or otherwise handled through an explicit reported connection-failure channel. The API should not signal successful notification publication after transport delivery has failed.

## Impact

Callers dynamically adding or removing tools can believe clients were notified of a changed tool list when no notification reached the connected SDK client. The client may continue using stale tool discovery state, and the detached rejection can surface outside the triggering operation as an unhandled asynchronous failure, making recovery and diagnosis unreliable.
