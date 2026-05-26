# Tiny MCP client delivers resource updates for unsubscribed URIs

## Summary

The exported `tiny-mcp-client` `McpClient` forwards `notifications/resources/updated` to `onResourceUpdated` without verifying that the client subscribed to the referenced resource URI, or even that the server advertised resource subscription support. A connected server can therefore manufacture application-visible update events for arbitrary resources.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { McpClient, readLines, type McpTransport } from "./internal.js";

describe("unsolicited resource updated notification", () => {
  it("delivers an update for a resource the client never subscribed to", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const onResourceUpdated = vi.fn();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => undefined),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: { name: "probe", version: "1" },
      onResourceUpdated,
    });
    const connecting = client.connect(transport);
    const lines = readLines(writable)[Symbol.asyncIterator]();
    const initialize = await lines.next();
    const id = JSON.parse(initialize.value as string).id;
    readable.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "server", version: "1" },
      },
    })}\n`);
    await connecting;
    await lines.next();

    readable.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///unsubscribed.txt" },
    })}\n`);
    await vi.waitFor(() => expect(onResourceUpdated).toHaveBeenCalledOnce());

    expect(onResourceUpdated).toHaveBeenCalledWith("file:///unsubscribed.txt");
    await client.close();
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm packages/tiny-mcp-client/src/__probe__.test.ts
```

Observed test output:

```text
✓ packages/tiny-mcp-client/src/__probe__.test.ts > unsolicited resource updated notification > delivers an update for a resource the client never subscribed to
```

## Observed Behavior

The client initializes against a server that advertises empty capabilities and never calls `resources/subscribe`. Nevertheless, when that server sends a resource update for `file:///unsubscribed.txt`, `onResourceUpdated` runs with the arbitrary URI. `packages/tiny-mcp-client/src/internal.ts` registers the update-notification handler whenever a callback exists and validates only that `params.uri` is a string; it does not enforce negotiated `resources.subscribe` support or maintain a subscribed-URI set.

## Expected Behavior

`notifications/resources/updated` should be delivered only for URIs successfully subscribed by this client after the server advertises subscription capability. Updates for unsubscribed resources, or from servers that did not negotiate resource subscriptions, should be ignored or surfaced as protocol violations.

## Impact

An MCP server can fabricate cache invalidation, refresh prompts, or UI change signals for resources the client never requested. Consumers may perform unnecessary reads, display misleading resource changes, or make decisions based on unsolicited events that appear indistinguishable from valid subscription updates.
