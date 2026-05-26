# Tiny HTTP MCP server failed close cannot retry listener shutdown

## Summary

The `tiny-http-mcp-server` listening handle caches its first shutdown promise before the Node HTTP listener has successfully closed. If that listener shutdown rejects once, every subsequent `handle.close()` returns the same rejected promise and never retries the still-needed `server.close()` operation.

## Reproduction

Create the disposable probe `packages/tiny-http-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const { fakeServer, createServerMock } = vi.hoisted(() => {
  class FakeNodeServer {
    listening = true;
    private readonly listeners = new Map<string, Set<() => void>>();
    close = vi.fn((callback: (error?: Error) => void) => {
      if (this.close.mock.calls.length === 1) {
        callback(new Error("close temporarily failed"));
        return;
      }
      this.listening = false;
      callback();
    });
    closeIdleConnections = vi.fn();
    listen(): void {
      queueMicrotask(() => this.emit("listening"));
    }
    once(event: string, callback: () => void): void {
      this.listeners.set(event, new Set([callback]));
    }
    off(event: string, callback: () => void): void {
      this.listeners.get(event)?.delete(callback);
    }
    emit(event: string): void {
      for (const callback of this.listeners.get(event) ?? []) callback();
      this.listeners.delete(event);
    }
    address(): { port: number; address: string; family: string } {
      return { port: 43210, address: "127.0.0.1", family: "IPv4" };
    }
  }

  const fakeServer = new FakeNodeServer();
  return { fakeServer, createServerMock: vi.fn(() => fakeServer) };
});

vi.mock("node:http", async () => {
  const actual = await vi.importActual<typeof import("node:http")>("node:http");
  return {
    ...actual,
    default: { ...actual.default, createServer: createServerMock },
    createServer: createServerMock,
  };
});

import { createHttpServer } from "./http-server.js";

describe("tiny HTTP MCP failed close retry", () => {
  it("cannot retry a transient listener shutdown failure", async () => {
    const handle = await createHttpServer({ name: "test", version: "1" }).listenHttp();

    await expect(handle.close()).rejects.toThrow("close temporarily failed");
    await expect(handle.close()).rejects.toThrow("close temporarily failed");
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP failed close retry > cannot retry a transient listener shutdown failure
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`listenHttp()` returns a `close()` function that stores `closePromise` before awaiting `transport.close()` and `closeServer(nodeServer)` at `packages/tiny-http-mcp-server/src/http-server.ts:277` through `packages/tiny-http-mcp-server/src/http-server.ts:288`. `closeServer()` rejects when the Node listener's close callback reports an error at `packages/tiny-http-mcp-server/src/http-server.ts:134` through `packages/tiny-http-mcp-server/src/http-server.ts:151`. In the probe, the first listener close rejects transiently; the second public close call receives the already-rejected cached promise, and the underlying listener's `close()` is called only once even though it would succeed on retry.

## Expected Behavior

Failed listener shutdown should remain retryable through `HttpServerHandle.close()`, either by clearing a rejected cached promise or by retaining cleanup state until the listener is known to be closed. A transient first close failure should not make all later cleanup calls permanently replay the same failure without attempting shutdown.

## Impact

Transient HTTP listener shutdown errors can leave MCP endpoints bound and reachable while their public cleanup handle can no longer close them. Test fixtures, embedded servers, and host applications may leak ports or remain alive during teardown, and recovery attempts cannot restore a clean state through the supported API.
