# Tiny MCP client preaborted tool call is dispatched before rejection

## Summary

The exported `tiny-mcp-client` `McpClient.callTool()` API accepts an `AbortSignal`, but it sends the `tools/call` JSON-RPC request before checking whether that signal is already aborted. A caller canceling a tool invocation before dispatch still causes the remote tool request to be transmitted and potentially execute side effects, even though the local promise rejects as cancelled.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { McpClient, readLines, type McpTransport } from "./internal.js";

describe("pre-aborted tool call", () => {
  it("writes tools/call before rejecting an already-aborted signal", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => undefined),
      dispose: vi.fn(),
    };
    const client = new McpClient({ clientInfo: { name: "probe", version: "1" } });
    const connecting = client.connect(transport);
    const lines = readLines(writable)[Symbol.asyncIterator]();
    const initialize = await lines.next();
    const id = JSON.parse(initialize.value as string).id;
    readable.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "server", version: "1" },
      },
    })}\n`);
    await connecting;
    await lines.next();

    const controller = new AbortController();
    controller.abort("cancelled before dispatch");
    const rejected = expect(
      client.callTool({ name: "destructive" }, { signal: controller.signal }),
    ).rejects.toBe("cancelled before dispatch");
    const toolCall = await lines.next();

    expect(JSON.parse(toolCall.value as string).method).toBe("tools/call");
    await rejected;
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
✓ packages/tiny-mcp-client/src/__probe__.test.ts > pre-aborted tool call > writes tools/call before rejecting an already-aborted signal
```

## Observed Behavior

The abort controller is already aborted before `callTool()` is invoked, yet the writable transport receives a `tools/call` request for `destructive` before the returned promise rejects with the cancellation reason. At `packages/tiny-mcp-client/src/internal.ts`, `messageLayer.sendRequest("tools/call", ...)` is called before the abort listener is installed and before the `signal.aborted` branch executes.

## Expected Behavior

An already-aborted `callTool()` request should reject without sending `tools/call` to the remote server. Cancellation supplied before dispatch must prevent tool execution rather than merely sending a later cancellation notification after the request has already been transmitted.

## Impact

Callers cannot safely use pre-dispatch cancellation to prevent destructive or costly MCP tools from running. A cancelled operation may still modify files, start processes, perform network actions, or incur expense remotely while the local client reports only a rejected cancellation result.
