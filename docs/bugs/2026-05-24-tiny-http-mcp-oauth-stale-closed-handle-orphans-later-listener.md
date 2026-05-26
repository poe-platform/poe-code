# Tiny HTTP MCP OAuth stale closed handle orphans later listener

## Summary

After a `tiny-http-mcp-oauth-test-server` handle is closed and the same server object is started again, calling the old handle's `close()` a second time clears shared active-handle state for the newer listener pair. The newer handle then becomes unable to close its own still-running MCP and OAuth servers.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

describe("stale wrapper handle", () => {
  it("can clear a newer listener's teardown state after it was already closed", async () => {
    const server = createMcpOAuthTestServer({ autoApprove: true });
    const first = await server.listen({ hostname: "127.0.0.1", port: 0 });
    await first.close();
    const second = await server.listen({ hostname: "127.0.0.1", port: 0 });

    await first.close();
    await second.close();

    const leakedResponse = await nodeFetch(second.prmUrl);
    console.log(JSON.stringify({ first: first.mcpUrl, second: second.mcpUrl, leakedStatus: leakedResponse.status }));
    expect(leakedResponse.status).toBe(200);
  });
});
PROBE
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts
```

Output:

```text
{"first":"http://127.0.0.1:49180/mcp","second":"http://127.0.0.1:49182/mcp","leakedStatus":200}
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > stale wrapper handle > can clear a newer listener's teardown state after it was already closed
```

## Observed Behavior

The server permits a new `listen()` once a prior close sets `currentHandle = null`. However, every returned `close()` closure tests and clears that same shared variable, rather than recording whether its own captured `mcpHandle` and `oauthHandle` have already been closed, at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:286` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:313`. Calling the already-closed first handle while the second handle is active consequently clears state for the second listener and closes only the first handle's already-released captures. The subsequent `second.close()` returns immediately and its protected-resource metadata endpoint remains reachable.

## Expected Behavior

A handle that has already completed cleanup should be idempotent without changing the teardown state of a later server lifetime. Closing a new handle should always release the listener pair started for that handle.

## Impact

Ordinary cleanup registries can retain old close callbacks across repeated fixture startups. Invoking stale teardown callbacks out of order can silently leak a newly started OAuth-protected MCP endpoint, keep test processes alive, consume ports, and expose fixture services after callers believe teardown succeeded. Unlike the concurrent-listen leak, this requires no overlapping startup calls and occurs across sequential supported lifetimes.
