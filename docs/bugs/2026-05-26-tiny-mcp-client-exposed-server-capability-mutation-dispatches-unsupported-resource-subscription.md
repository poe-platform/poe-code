# Tiny MCP client exposed server capability mutation dispatches unsupported resource subscription

## Summary

The exported `tiny-mcp-client` `McpClient.serverCapabilities` getter returns the mutable capability object negotiated during initialization. The client later relies on that same object to guard resource subscription calls, so a caller can mutate a server that advertised resources without subscription support into appearing subscribable and dispatch an unsupported `resources/subscribe` request.

## Reproduction

Create a disposable probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { McpClient, createMockResourceServer, createSdkTestPair } from "./internal.js";

describe("tiny-mcp-client exposed capability mutation", () => {
  it("dispatches an unsupported resource subscription after getter mutation", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: { name: "probe", version: "1.0.0" }
      })
    );

    try {
      await expect(client.subscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );

      client.serverCapabilities!.resources!.subscribe = true;

      await expect(client.subscribe("file:///readme.txt")).rejects.toThrow(/Method not found/i);
    } finally {
      await cleanup();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-mcp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-mcp-client/src/__probe__.test.ts > tiny-mcp-client exposed capability mutation > dispatches an unsupported resource subscription after getter mutation
```

## Observed Behavior

`McpClient` is exported through the package entry point at `packages/tiny-mcp-client/src/index.ts:1` through `packages/tiny-mcp-client/src/index.ts:17`. During initialization, it stores the server response's `capabilities` object by reference at `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:356`, and its public `serverCapabilities` getter returns that same reference at `packages/tiny-mcp-client/src/internal.ts:128` through `packages/tiny-mcp-client/src/internal.ts:134`. The `subscribe()` and `unsubscribe()` methods read that mutable object before sending protocol requests at `packages/tiny-mcp-client/src/internal.ts:479` through `packages/tiny-mcp-client/src/internal.ts:497`.

In the probe, `createMockResourceServer()` advertises `resources: {}` and no subscription method. Before mutation, `client.subscribe()` rejects locally with `Server does not support resource subscriptions`. After assigning `client.serverCapabilities.resources.subscribe = true`, the local guard is bypassed and the same call reaches the server, which rejects it as an unimplemented `resources/subscribe` method.

## Expected Behavior

Negotiated server capabilities should remain authoritative for the connection and must not be modifiable through public inspection APIs. Reading `serverCapabilities` should return immutable metadata or a defensive copy, and subscription guards should continue enforcing what the server actually advertised during initialization.

## Impact

Any same-process consumer that inspects a connected MCP client's public metadata can silently enable later requests that its server never negotiated, including resource subscriptions and other capability-gated operations. This creates protocol traffic inconsistent with the handshake, leading to spurious failures, unintended server behavior when unadvertised methods happen to exist, and misleading application logic that believes the server authorized the capability.
