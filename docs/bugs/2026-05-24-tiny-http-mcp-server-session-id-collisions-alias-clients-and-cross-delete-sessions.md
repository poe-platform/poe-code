# Tiny HTTP MCP server session ID collisions alias clients and cross-delete sessions

## Summary

`tiny-http-mcp-server` accepts arbitrary values returned by its configurable `sessionIdGenerator` without checking whether the identifier is already in use. If the generator repeats an identifier, separate initializing clients are assigned the same live session; terminating either client's session then deletes the other client's session as well.

## Reproduction

From the repository root, run a disposable Vitest probe that supplies a generator returning the same ID for two initialize requests, deletes through the first client's handle, and retries through the second:

```sh
cat > /tmp/tiny-http-mcp-session-id-collision-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP session id collision", () => {
  it("mints the same session id for separate initialize requests without detecting collision", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: () => "shared-session" });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const initialize = () => nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      });
      const first = await initialize();
      const second = await initialize();
      const firstId = first.headers.get("mcp-session-id");
      const secondId = second.headers.get("mcp-session-id");
      const deleted = await nodeFetch(handle.url, { method: "DELETE", headers: { "Mcp-Session-Id": firstId ?? "" } });
      const afterDelete = await nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Mcp-Session-Id": secondId ?? "" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
      console.log(JSON.stringify({ firstId, secondId, deletedStatus: deleted.status, secondAfterDeleteStatus: afterDelete.status }));
      expect(firstId).toBe("shared-session");
      expect(secondId).toBe("shared-session");
      expect(deleted.status).toBe(204);
      expect(afterDelete.status).toBe(404);
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-session-id-collision-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both independent clients receive the same session ID, and deletion performed with one client's returned identifier immediately invalidates the other client's session:

```text
{"firstId":"shared-session","secondId":"shared-session","deletedStatus":204,"secondAfterDeleteStatus":404}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP session id collision > mints the same session id for separate initialize requests without detecting collision
```

`packages/tiny-http-mcp-server/src/http-transport.ts:126` through `packages/tiny-http-mcp-server/src/http-transport.ts:133` invoke the configured session ID generator and unconditionally create the returned identifier. `packages/tiny-http-mcp-server/src/session.ts:20` through `packages/tiny-http-mcp-server/src/session.ts:34` store sessions with `Map.set()`, silently replacing an existing record for the same ID rather than rejecting collisions or generating a distinct ID. Deletion at `packages/tiny-http-mcp-server/src/http-transport.ts:262` through `packages/tiny-http-mcp-server/src/http-transport.ts:274` consequently terminates the single aliased record.

## Expected Behavior

New stateful client sessions must receive unique session identifiers. If a configured generator returns an existing ID, the transport should reject the collision or request a replacement rather than aliasing independent clients to the same session record.

## Impact

A faulty, low-entropy, or adversarial session ID generator can collapse client isolation. One client can unintentionally or deliberately terminate another client's session, share its stream namespace, or cause confusing authorization and lifecycle behavior under a reused session handle.
