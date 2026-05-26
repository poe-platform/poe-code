# Tiny HTTP MCP testing pair connect failure leaks started listener

## Summary

The public `tiny-http-mcp-server/testing` `createHttpTestPair()` helper starts an HTTP MCP listener before attempting the SDK client's initialization connection. If `client.connect()` rejects, the factory rejects without closing the already-started `HttpServerHandle`, leaving the listener alive while returning no cleanup handle to the caller.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from 'vitest';

const connectMock = vi.hoisted(() => vi.fn(async () => {
  throw new Error('initialize rejected');
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connectMock;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}));

describe('HTTP test-pair failed connection cleanup repro', () => {
  it('rejects after starting a listener without closing it when client connection fails', async () => {
    const close = vi.fn(async () => undefined);
    const server = {
      listenHttp: vi.fn(async () => ({
        url: 'http://127.0.0.1:8123/mcp',
        port: 8123,
        close,
      })),
    };
    const { createHttpTestPair } = await import('./testing.js');

    await expect(createHttpTestPair(server as never)).rejects.toThrow('initialize rejected');

    expect(server.listenHttp).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > HTTP test-pair failed connection cleanup repro > rejects after starting a listener without closing it when client connection fails
```

## Observed Behavior

`createHttpTestPair()` awaits `server.listenHttp({ port: 0 })` at `packages/tiny-http-mcp-server/src/testing.ts:172`, constructs a client and transport, and then awaits `client.connect(transport)` at `packages/tiny-http-mcp-server/src/testing.ts:179`. Its only call to `handle.close()` is inside the `cleanup()` function returned after that connection succeeds at `packages/tiny-http-mcp-server/src/testing.ts:181`. In the probe, initialization rejects after listener creation, the exported factory rejects, and `close()` is never invoked.

## Expected Behavior

If client initialization fails after the helper has created a listener, `createHttpTestPair()` should close that listener before rejecting, while preserving the original setup error or exposing cleanup failure clearly. A failed factory call should not leave resources that can only be released through a result object that was never returned.

## Impact

Tests that intentionally exercise failed MCP handshakes, malformed servers, transient initialization errors, or protocol mismatch behavior can leak local HTTP listeners and associated sessions during setup. Repeated failed setup attempts can keep ports and resources alive, interfere with subsequent tests, or prevent the test process from exiting cleanly even though the pair factory already reported failure.
