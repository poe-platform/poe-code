# Tiny HTTP MCP server rejects entire JSON-RPC batch when one element is invalid

## Summary

`tiny-http-mcp-server` aborts parsing an entire JSON-RPC batch when any one batch member is invalid. As a result, valid requests in the same batch are never processed and the client receives one top-level `Invalid Request` response instead of per-member responses for the valid requests and the malformed member.

## Reproduction

From the repository root, run a disposable Vitest probe that sends two valid `ping` requests around an invalid primitive batch member:

```sh
cat > /tmp/tiny-http-mcp-invalid-batch-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP invalid batch element", () => {
  it("discards valid batch requests when any sibling element is invalid", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: undefined });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const response = await nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          17,
          { jsonrpc: "2.0", id: 2, method: "ping" },
        ]),
      });
      const body = await response.json();
      console.log(JSON.stringify({ status: response.status, body }));
      expect(response.status).toBe(400);
      expect(body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-invalid-batch-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The server returns one error for the batch as a whole and omits both valid `ping` results:

```text
{"status":400,"body":{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP invalid batch element > discards valid batch requests when any sibling element is invalid
```

`packages/tiny-http-mcp-server/src/parse-body.ts:131` through `packages/tiny-http-mcp-server/src/parse-body.ts:165` iterate batch elements, but throw immediately when any one member cannot be parsed. `packages/tiny-http-mcp-server/src/http-transport.ts:104` through `packages/tiny-http-mcp-server/src/http-transport.ts:115` catch that throw and emit one HTTP/JSON-RPC invalid-request response before dispatching any accumulated valid messages.

## Expected Behavior

Under JSON-RPC batch processing, each invalid request object in a non-empty batch should produce its own `Invalid Request` error response, while independently valid request members should still be executed and receive their corresponding results. The response should include entries for ids `1` and `2` as well as the malformed member error.

## Impact

A single malformed entry can suppress unrelated valid operations submitted in the same batch. Clients cannot reliably correlate successful sibling requests, and a buggy or attacker-controlled batch member can force legitimate batched MCP work to be dropped without individual results.
