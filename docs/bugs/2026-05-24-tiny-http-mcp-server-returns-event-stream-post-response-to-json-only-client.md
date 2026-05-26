# Tiny HTTP MCP server returns event-stream POST response to JSON-only client

## Summary

When configured to return POST results using Server-Sent Events, `tiny-http-mcp-server` emits a `text/event-stream` representation even when the request explicitly accepts only `application/json`. The transport validates the request's `Content-Type` but never checks the client's `Accept` header before selecting its response representation.

## Reproduction

From the repository root, run a disposable Vitest probe that configures SSE responses and sends an initialize request with `Accept: application/json` only:

```sh
cat > /tmp/tiny-http-mcp-sse-without-accept-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP POST Accept negotiation", () => {
  it("returns event-stream responses to clients that only accept application/json", async () => {
    const server = createTestMcpServer({ enableJsonResponse: false, sessionIdGenerator: undefined });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const response = await nodeFetch(handle.url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      });
      const body = await response.text();
      console.log(JSON.stringify({ status: response.status, contentType: response.headers.get("content-type"), bodyPrefix: body.slice(0, 32) }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-sse-without-accept-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Although the request advertises only JSON as acceptable, the successful response is an SSE payload:

```text
{"status":200,"contentType":"text/event-stream","bodyPrefix":"data: {\"jsonrpc\":\"2.0\",\"id\":1,\"r"}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP POST Accept negotiation > returns event-stream responses to clients that only accept application/json
```

`packages/tiny-http-mcp-server/src/http-transport.ts:94` through `packages/tiny-http-mcp-server/src/http-transport.ts:101` validate only the inbound JSON content type. After request execution, `packages/tiny-http-mcp-server/src/http-transport.ts:184` through `packages/tiny-http-mcp-server/src/http-transport.ts:206` choose JSON or SSE solely from `enableJsonResponse`, without examining the request's `Accept` header.

## Expected Behavior

The server should return a representation allowed by the request's `Accept` header, or reject the request with an appropriate client error when its configured representation is not acceptable. A JSON-only client must not receive an unsolicited `text/event-stream` POST result.

## Impact

HTTP MCP clients that legitimately request only JSON can receive an unexpected streaming representation they are not prepared to parse. This breaks response negotiation, can turn successful MCP replies into apparent protocol failures or timeouts, and makes interoperability depend on undocumented server configuration rather than declared client capabilities.
