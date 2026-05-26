# Tiny stdio MCP server huge numeric request id returns null response id

## Summary

`tiny-stdio-mcp-server` parses a JSON-RPC request identifier such as `1e999` into JavaScript `Infinity`, accepts it as a valid numeric request ID, and later serializes the corresponding response ID as `null`. The server therefore cannot correlate its response with the identifier supplied on the wire, even for a basic valid method call.

## Reproduction

From the repository root, run a disposable Vitest probe that parses a request with a huge numeric identifier and formats its successful response:

```sh
cat > packages/tiny-stdio-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { formatSuccessResponse, parseMessage } from "./jsonrpc.js";

describe("nonfinite JSON-RPC identifier repro", () => {
  it("accepts a huge numeric id then serializes its response id as null", () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":1e999,"method":"ping"}');
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.isNotification) throw new Error("expected request");
    const response = formatSuccessResponse(parsed.request.id, {});
    console.log(JSON.stringify({ parsedId: parsed.request.id, response }));
    expect(parsed.request.id).toBe(Number.POSITIVE_INFINITY);
    expect(response).toBe('{"jsonrpc":"2.0","id":null,"result":{}}');
  });
});
EOF
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
nl -ba packages/tiny-stdio-mcp-server/src/jsonrpc.ts | sed -n '18,118p'
```

## Observed Behavior

The request is accepted, but the emitted response contains `id: null` rather than preserving the submitted numeric identifier:

```text
{"parsedId":null,"response":"{\"jsonrpc\":\"2.0\",\"id\":null,\"result\":{}}"}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > nonfinite JSON-RPC identifier repro > accepts a huge numeric id then serializes its response id as null
```

The printed `parsedId` appears as `null` because `JSON.stringify()` itself converts the in-memory `Infinity` value to `null`; the test assertion demonstrates that the parsed in-memory request ID is `Number.POSITIVE_INFINITY`. `parseMessage()` accepts any value with JavaScript type `number` as an ID in `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:51` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:105`, without checking finiteness. `formatSuccessResponse()` then sends that value through `JSON.stringify()` in `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:108` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:118`, which changes it to `null` on the wire.

## Expected Behavior

The server should reject numeric identifiers that it cannot round-trip exactly through its response serializer, or otherwise preserve the submitted identifier representation. It must not accept a request under one identifier and respond under a different identifier.

## Impact

Clients that submit a large numeric JSON-RPC ID can receive a successful response that cannot be matched to the outstanding request because its ID has changed to `null`. Requests may be treated as unanswered or mismatched, causing hangs, retries, or protocol desynchronization despite successful method execution.
