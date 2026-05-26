# Tiny stdio MCP server accepts primitive JSON-RPC params member

## Summary

`tiny-stdio-mcp-server` accepts JSON-RPC requests whose `params` member is a primitive string and returns them as valid parsed requests. Under JSON-RPC 2.0, when `params` is present it must be a Structured value: an Object or Array. The server therefore accepts malformed protocol input instead of returning an invalid-request response.

## Reproduction

From the repository root, run a disposable Vitest probe that parses a JSON-RPC request with string-valued `params`:

```sh
cat > packages/tiny-stdio-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseMessage } from "./jsonrpc.js";

describe("primitive JSON-RPC params repro", () => {
  it("accepts a string params member as a valid request", () => {
    const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":"not-structured"}');
    console.log(JSON.stringify(result));
    expect(result).toMatchObject({ success: true, request: { params: "not-structured" } });
  });
});
EOF
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
nl -ba packages/tiny-stdio-mcp-server/src/jsonrpc.ts | sed -n '26,105p'
```

## Observed Behavior

The parser reports a request containing primitive string `params` as successful and forwards that value in the parsed request:

```text
{"success":true,"isNotification":false,"request":{"jsonrpc":"2.0","id":1,"method":"tools/list","params":"not-structured"}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > primitive JSON-RPC params repro > accepts a string params member as a valid request
```

`parseMessage()` verifies only the containing object, protocol version, method name, and request identifier in `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:26` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:105`. For both notifications and requests, it copies `obj.params` through a TypeScript assertion to `Record<string, unknown> | undefined` without runtime shape validation. The JSON-RPC 2.0 request specification states that `params`, if present, must be a Structured value, so a string-valued member is malformed protocol input.

## Expected Behavior

Requests and notifications with a present `params` value that is neither an object nor an array should be rejected as invalid JSON-RPC requests before dispatch, rather than accepted and forwarded as typed parameter objects.

## Impact

Malformed clients can send requests the server treats as valid while downstream handlers assume structured parameters. This weakens protocol validation, can produce method-specific misleading behavior from invalid wire messages, and makes the server incompatible with clients or gateways that enforce JSON-RPC request structure strictly.
