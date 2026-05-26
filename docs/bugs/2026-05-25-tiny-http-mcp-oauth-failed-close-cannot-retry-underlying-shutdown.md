# Tiny HTTP MCP OAuth failed close cannot retry underlying shutdown

## Summary

The `tiny-http-mcp-oauth-test-server` handle marks the server instance as no longer active before its MCP and OAuth listener shutdown operations have succeeded. If one underlying `close()` rejects transiently, the public `handle.close()` call rejects, but any later retry immediately returns without attempting the failed shutdown again. A listener that failed to close can therefore remain active while its only cleanup handle reports completion on retry.

## Reproduction

Create a disposable Vitest probe that mocks the MCP listener close operation to reject once and then succeed if retried:

```sh
cat > packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

const { oauthClose, mcpClose } = vi.hoisted(() => ({
  oauthClose: vi.fn(async () => undefined),
  mcpClose: vi.fn()
}));

vi.mock("tiny-oauth-test-server", () => ({
  createOAuthTestServer: vi.fn(() => ({
    issuer: "http://127.0.0.1:41001/oauth",
    listen: vi.fn(async () => ({ close: oauthClose }))
  }))
}));

vi.mock("tiny-http-mcp-server", () => ({
  TokenVerificationError: class extends Error {},
  nodeFetch: vi.fn(),
  createTestMcpServer: vi.fn(() => ({
    listenHttp: vi.fn(async () => ({
      url: "http://127.0.0.1:41002/mcp",
      close: mcpClose
    }))
  }))
}));

describe("MCP OAuth failed close retry", () => {
  it("cannot retry a failed underlying server shutdown", async () => {
    mcpClose.mockRejectedValueOnce(new Error("MCP close failed")).mockResolvedValueOnce(undefined);
    const server = createMcpOAuthTestServer({
      issuer: "http://127.0.0.1:41001/oauth",
      resource: "http://127.0.0.1:41002/mcp"
    });
    const handle = await server.listen({ port: 41002, hostname: "127.0.0.1" });

    await expect(handle.close()).rejects.toThrow("MCP close failed");
    await expect(handle.close()).resolves.toBeUndefined();

    expect(mcpClose).toHaveBeenCalledOnce();
    expect(oauthClose).toHaveBeenCalledOnce();
  });
});
EOF
trap 'rm -f packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
nl -ba packages/tiny-http-mcp-oauth-test-server/src/index.ts | sed -n '278,320p'
```

The probe passes:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth failed close retry > cannot retry a failed underlying server shutdown
```

## Observed Behavior

The returned handle's `close()` implementation first checks whether `currentHandle` is `null`, then sets `currentHandle = null` at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:287` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:292`. Only afterward does it await both underlying shutdown promises via `Promise.allSettled()` at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:294` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:306`. In the probe, the first MCP close rejects and the public close rejects, but a second `handle.close()` observes the prematurely cleared handle state and returns immediately; the mock MCP close is called only once even though it was configured to succeed on retry.

## Expected Behavior

A failed shutdown should leave enough ownership state for the same handle to retry any listener close operation that did not complete. The handle should be considered fully closed only after both managed listeners have shut down successfully, or it should explicitly track and retry individually failed cleanup steps.

## Impact

Transient cleanup failures can leak OAuth-protected MCP test listeners, open ports, and server resources after callers attempt the natural retry path. Test teardown may report eventual success while a failed listener remains alive, causing hanging processes, cross-test interference, or unintended availability of fixture endpoints.
