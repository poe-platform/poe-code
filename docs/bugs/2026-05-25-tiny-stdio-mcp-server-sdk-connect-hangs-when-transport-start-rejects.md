# Tiny stdio MCP server SDK connect hangs when transport start rejects

## Summary

`tiny-stdio-mcp-server`'s `connectSDK()` method calls the asynchronous SDK transport `start()` operation without awaiting it or connecting its rejection to the returned connection promise. If transport startup fails, callers awaiting `connectSDK()` remain pending indefinitely rather than receiving the startup failure.

## Reproduction

Create the disposable probe `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./server.js";

describe("tiny stdio SDK failed transport start", () => {
  it("leaves connect pending after the SDK transport start rejects", async () => {
    const server = createServer({ name: "probe", version: "1" });
    const start = vi.fn().mockRejectedValue(new Error("transport start failed"));
    const connection = server.connectSDK({
      start,
      close: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(start).toHaveBeenCalledOnce();
    await expect(Promise.race([connection.then(() => "settled"), Promise.resolve("pending")]))
      .resolves.toBe("pending");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio SDK failed transport start > leaves connect pending after the SDK transport start rejects
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`connectSDK()` creates and returns a promise that only resolves from `transport.onclose` at `packages/tiny-stdio-mcp-server/src/server.ts:277` through `packages/tiny-stdio-mcp-server/src/server.ts:323`. It invokes `transport.start()` at `packages/tiny-stdio-mcp-server/src/server.ts:322` without awaiting that promise or rejecting the outer promise when it fails. In the probe, `start()` rejects immediately with `transport start failed`, but the public `connectSDK()` promise remains unsettled.

## Expected Behavior

Failure to start the supplied SDK transport should reject `connectSDK()` with the startup error and release any notification subscription installed for that failed connection. A caller should not have to wait for an `onclose` callback from a transport that never successfully started.

## Impact

Applications embedding the stdio MCP server over SDK-compatible transports can hang forever during initialization failures, preventing orderly error handling and shutdown. Transport setup issues such as rejected socket/session creation become stuck startup operations rather than recoverable connection errors.
