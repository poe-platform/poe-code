# Tiny stdio MCP server request-form initialized message never answers request

## Summary

The exported `tiny-stdio-mcp-server` stdio server accepts `notifications/initialized` when it is sent as a JSON-RPC **request** carrying an `id`, but emits no success or error response for that request. A client that accidentally or maliciously sends request-form lifecycle acknowledgement receives an answer to `initialize` and then waits forever for the outstanding `notifications/initialized` request id.

## Reproduction

Create the disposable probe `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer } from "./server.js";

describe("request-form initialized lifecycle message", () => {
  it("consumes a JSON-RPC request without emitting any response", async () => {
    const output: string[] = [];
    const readable = new Readable({ read() {} });
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      }
    });
    const server = createServer({ name: "probe", version: "1" });
    const connection = server.connect({ readable, writable });

    readable.push('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    readable.push('{"jsonrpc":"2.0","id":2,"method":"notifications/initialized"}\n');
    readable.push(null);
    await connection;

    const responses = output.map((line) => JSON.parse(line.trim()));
    console.log(JSON.stringify(responses));
    expect(responses.map((response) => response.id)).toEqual([1]);
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes and prints only the initialization response, with no message for request id `2`:

```text
[{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"probe","version":"1"}}}]
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > request-form initialized lifecycle message > consumes a JSON-RPC request without emitting any response
```

## Observed Behavior

`handleMessage()` returns `{ result: undefined }` for every `notifications/initialized` message at `packages/tiny-stdio-mcp-server/src/server.ts:87`, regardless of whether the message arrived as a notification or a request with an id. `processLine()` correctly distinguishes requests from notifications at `packages/tiny-stdio-mcp-server/src/server.ts:181` through `packages/tiny-stdio-mcp-server/src/server.ts:191`, but it writes a successful response only when `result !== undefined` at `packages/tiny-stdio-mcp-server/src/server.ts:193` through `packages/tiny-stdio-mcp-server/src/server.ts:197`. A request-form `notifications/initialized` therefore passes through the request path and is silently dropped without a response.

## Expected Behavior

`notifications/initialized` should be accepted only in JSON-RPC notification form, or request-form usage should receive an explicit error response tied to its request id. The server must not consume a JSON-RPC request without completing it with either a result or an error.

## Impact

Clients using generic request dispatch, buggy lifecycle wrappers, or adversarial peers can leave an outstanding request permanently unanswered even though the server remains connected. This can hang MCP initialization state machines, leak pending request bookkeeping, or desynchronize higher-level connection setup and shutdown handling.
