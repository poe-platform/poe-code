# Tiny MCP client delivers unsolicited progress for unknown token

## Summary

The exported `tiny-mcp-client` `McpClient` invokes its `onProgress` callback for any structurally valid `notifications/progress` message, even when the server uses a `progressToken` that the client never attached to any request. A server can therefore fabricate progress events unrelated to active client work and have them accepted as ordinary operation updates.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { McpClient, readLines, type McpTransport } from "./internal.js";

describe("unsolicited progress notification", () => {
  it("delivers progress for a token the client never requested", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const onProgress = vi.fn();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => undefined),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: { name: "probe", version: "1" },
      onProgress,
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
      method: "notifications/progress",
      params: { progressToken: "never-requested", progress: 50 },
    })}\n`);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledOnce());

    expect(onProgress).toHaveBeenCalledWith({
      progressToken: "never-requested",
      progress: 50,
    });
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
✓ packages/tiny-mcp-client/src/__probe__.test.ts > unsolicited progress notification > delivers progress for a token the client never requested
```

## Observed Behavior

After a normal MCP initialization with no tool call or request carrying `_meta.progressToken`, the server sends `notifications/progress` for `"never-requested"` and `onProgress` is invoked with that event. In `packages/tiny-mcp-client/src/internal.ts`, the progress notification handler checks only the structural types of `progressToken`, `progress`, `total`, and `message`; it does not retain or verify tokens provided by outgoing requests before delivering progress to application callbacks.

## Expected Behavior

Progress notifications should be delivered only for progress tokens the client supplied on an active or recognized request, or unsolicited tokens should be rejected or ignored as protocol-invalid input. A server should not be able to create application-visible progress for work that was never initiated by the client.

## Impact

Clients can display false progress, advance UI state, log misleading operation activity, or trigger automation based on fabricated updates from a connected MCP server. The issue is distinct from optional capability-notification handling because it permits invented per-request activity without any corresponding requested operation.
