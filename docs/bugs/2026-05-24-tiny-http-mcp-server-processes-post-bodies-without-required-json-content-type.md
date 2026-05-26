# Tiny HTTP MCP server processes POST bodies without required JSON content type

## Summary

`tiny-http-mcp-server` processes JSON-RPC POST bodies even when the request supplies no `Content-Type` header. Its media-type validator treats an absent header as valid JSON input rather than requiring the HTTP MCP request representation to be declared as `application/json`.

## Reproduction

From the repository root, run a disposable Vitest probe that sends an initialization POST with a JSON body but deliberately omits `Content-Type`:

```sh
cat > /tmp/tiny-http-mcp-missing-content-type-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP missing POST content type", () => {
  it("processes a JSON request body with no Content-Type header", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: undefined });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const response = await nodeFetch(handle.url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      });
      const body = await response.json();
      console.log(JSON.stringify({ status: response.status, protocolVersion: body.result.protocolVersion }));
      expect(response.status).toBe(200);
      expect(body.result.protocolVersion).toBe("2025-03-26");
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-missing-content-type-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The headerless POST is accepted and the JSON-RPC initialization request succeeds:

```text
{"status":200,"protocolVersion":"2025-03-26"}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP missing POST content type > processes a JSON request body with no Content-Type header
```

`packages/tiny-http-mcp-server/src/http-transport.ts:94` through `packages/tiny-http-mcp-server/src/http-transport.ts:101` use `isJsonRequest()` as the sole POST media-type gate. `packages/tiny-http-mcp-server/src/http-transport.ts:298` through `packages/tiny-http-mcp-server/src/http-transport.ts:308` explicitly return `true` when `req.headers["content-type"]` is absent, allowing undeclared bodies into JSON-RPC request processing.

## Expected Behavior

POST requests carrying MCP JSON-RPC messages should declare `Content-Type: application/json`; a request that omits the required representation type should be rejected rather than interpreted as valid MCP JSON input.

## Impact

The server accepts traffic that does not meet the HTTP transport contract, masking broken or non-compliant clients and weakening content-type boundaries used by proxies, middleware, security filters, and observability systems to identify MCP JSON requests accurately.
