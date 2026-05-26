# Tiny HTTP MCP server accepts follow-up requests with missing or contradictory protocol version header

## Summary

After a stateful HTTP session initializes, `tiny-http-mcp-server` executes later requests without checking the required `MCP-Protocol-Version` header at all. Follow-up requests succeed both when the negotiated version header is absent and when the client supplies a completely contradictory version value.

## Reproduction

From the repository root, run a disposable Vitest probe that initializes a session for protocol version `2025-03-26`, then submits `tools/list` once without a version header and once with an unrelated future value:

```sh
cat > /tmp/tiny-http-mcp-missing-or-invalid-version-header-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP follow-up protocol headers", () => {
  it("accepts follow-up requests with missing and contradictory version headers", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: () => "session-1" });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const initialized = await nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      });
      const sessionId = initialized.headers.get("mcp-session-id") ?? "";
      const post = (id: number, extraHeaders: Record<string, string> = {}) => nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Mcp-Session-Id": sessionId, ...extraHeaders },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
      });
      const missing = await post(2);
      const contradictory = await post(3, { "MCP-Protocol-Version": "2099-99-99" });
      const missingBody = await missing.json();
      const contradictoryBody = await contradictory.json();
      console.log(JSON.stringify({ sessionId, missingStatus: missing.status, missingTools: missingBody.result.tools.length, contradictoryStatus: contradictory.status, contradictoryTools: contradictoryBody.result.tools.length }));
      expect(missing.status).toBe(200);
      expect(contradictory.status).toBe(200);
      expect(missingBody.result.tools.length).toBeGreaterThan(0);
      expect(contradictoryBody.result.tools.length).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-missing-or-invalid-version-header-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both follow-up calls are processed successfully despite neither carrying the protocol version negotiated for the session:

```text
{"sessionId":"session-1","missingStatus":200,"missingTools":14,"contradictoryStatus":200,"contradictoryTools":14}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP follow-up protocol headers > accepts follow-up requests with missing and contradictory version headers
```

`packages/tiny-http-mcp-server/src/http-transport.ts:123` through `packages/tiny-http-mcp-server/src/http-transport.ts:139` validate only the `Mcp-Session-Id` header when associating requests with a session. The transport dispatches messages after that lookup without ever reading or comparing `MCP-Protocol-Version`; its only header readers at `packages/tiny-http-mcp-server/src/http-transport.ts:277` through `packages/tiny-http-mcp-server/src/http-transport.ts:309` concern the session ID and request content type.

## Expected Behavior

Following initialization, each stateful client request should carry the protocol version associated with the established MCP session, and the server should reject missing or conflicting version headers rather than executing ordinary methods under an ambiguous protocol contract.

## Impact

Clients can continue using a session while omitting or contradicting its negotiated protocol revision. This defeats version enforcement, hides misconfigured or non-compliant peers, and permits later method traffic to be interpreted without a reliable indication of which MCP behavior and capabilities the client believes apply.
