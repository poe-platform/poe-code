# Tiny HTTP MCP testing pair client close failure skips listener cleanup

## Summary

The public `tiny-http-mcp-server/testing` `createHttpTestPair()` helper tears down a connected pair sequentially. If `client.close()` rejects, its `cleanup()` function never attempts the independent `HttpServerHandle.close()` call, leaving the HTTP listener running even when listener shutdown itself would succeed.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from 'vitest';

const closeClientMock = vi.hoisted(() => vi.fn(async () => {
  throw new Error('client shutdown failed');
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn(async () => undefined);
    close = closeClientMock;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}));

describe('HTTP test-pair cleanup sequencing repro', () => {
  it('leaves its listener open when closing the client rejects first', async () => {
    const closeHandle = vi.fn(async () => undefined);
    const server = {
      listenHttp: vi.fn(async () => ({
        url: 'http://127.0.0.1:8123/mcp',
        port: 8123,
        close: closeHandle,
      })),
    };
    const { createHttpTestPair } = await import('./testing.js');
    const pair = await createHttpTestPair(server as never);

    await expect(pair.cleanup()).rejects.toThrow('client shutdown failed');

    expect(closeHandle).not.toHaveBeenCalled();
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > HTTP test-pair cleanup sequencing repro > leaves its listener open when closing the client rejects first
```

## Observed Behavior

After successful pair creation, `cleanup()` awaits `client.close()` and only afterward awaits `handle.close()` at `packages/tiny-http-mcp-server/src/testing.ts:181`. In the reproduction, the client cleanup rejects while the listener handle is independently closable. The exported teardown promise rejects immediately and never invokes `handle.close()`.

## Expected Behavior

Pair cleanup should attempt all independent teardown responsibilities even if one of them fails, then expose the relevant failure or aggregate errors. A client shutdown error must not prevent cleanup of a server listener that the same helper created and still owns.

## Impact

Test suites can leak live MCP listeners whenever SDK client teardown fails transiently, throws due to transport state, or is intentionally fault-injected. The returned cleanup operation reports failure but unnecessarily leaves server ports and sessions alive, causing hanging test processes, later port conflicts, and cross-test interference.
