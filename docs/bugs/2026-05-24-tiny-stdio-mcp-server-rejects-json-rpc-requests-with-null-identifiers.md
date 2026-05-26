# Tiny stdio MCP server rejects JSON-RPC requests with null identifiers

## Summary

`tiny-stdio-mcp-server` rejects a JSON-RPC 2.0 request whenever its explicit `id` is `null`, even though JSON-RPC allows a request identifier to be a String, Number, or Null value when the member is present. Instead of invoking the valid request and replying with the same null identifier, the server returns `Invalid Request`.

## Reproduction

From the repository root, run a disposable Vitest probe that sends a `ping` request carrying an explicit null identifier over the public stdio transport:

```sh
cat > /tmp/tiny-stdio-mcp-null-id-probe.test.ts <<'PROBE'
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("tiny stdio MCP JSON-RPC null id", () => {
  it("rejects a valid JSON-RPC request identifier of null as invalid request", async () => {
    const output: string[] = [];
    const readable = new Readable({ read() {} });
    const writable = new Writable({ write(chunk, _encoding, callback) { output.push(chunk.toString()); callback(); } });
    const server = createServer({ name: "probe", version: "1" });
    const connection = server.connect({ readable, writable });
    readable.push('{"jsonrpc":"2.0","id":null,"method":"ping"}\n');
    readable.push(null);
    await connection;
    console.log(JSON.stringify(output));
    expect(output).toEqual(['{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}\n']);
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-null-id-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The valid method is not invoked; the wire response is an invalid-request error with the supplied null identifier:

```text
["{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32600,\"message\":\"Invalid Request\"}}\n"]
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP JSON-RPC null id > rejects a valid JSON-RPC request identifier of null as invalid request
```

The JSON-RPC 2.0 specification permits an included request `id` to contain a String, Number, or Null value, while discouraging Null only as a best-practice choice. `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:51` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:53` collapse any non-string/non-number identifier to `null`, and `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:89` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:97` reject that value unconditionally rather than preserving an explicit valid null identifier.

## Expected Behavior

An explicit `id: null` request should be treated as a JSON-RPC request, dispatched to its method, and receive a response with `id: null`. For `ping`, the server should return a successful result rather than `Invalid Request`.

## Impact

Compliant JSON-RPC clients that use the permitted null identifier cannot interoperate with the stdio MCP server. Requests that should complete normally are rejected as malformed, producing false protocol failures and unnecessary client incompatibility.
