# Tiny stdio MCP server infinite tool error code serializes as null

## Summary

The public `tiny-stdio-mcp-server` `ToolError` class accepts any numeric error code, including `Infinity`. When a tool throws `new ToolError(Infinity, ...)`, the server treats it as an ordinary JSON-RPC error and serializes its non-finite code as JSON `null`, emitting an invalid error response whose wire value no longer matches the supplied code.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer, defineSchema, ToolError } from "./index.js";

function nextLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    stream.once("data", (chunk) => resolve(String(chunk)));
  });
}

describe("tiny-stdio ToolError code serialization", () => {
  it("serializes an infinite public tool error code as null on the wire", async () => {
    const server = createServer({ name: "probe", version: "1.0.0" }).tool(
      "explode",
      "fails",
      defineSchema({}),
      async () => {
        throw new ToolError(Number.POSITIVE_INFINITY, "overflow");
      }
    );
    const readable = new PassThrough();
    const writable = new PassThrough();
    const connected = server.connect({ readable, writable });

    const initialized = nextLine(writable);
    readable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    await initialized;

    const responseLine = nextLine(writable);
    readable.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"explode","arguments":{}}}\n');

    await expect(responseLine).resolves.toContain(
      '"error":{"code":null,"message":"overflow"}'
    );

    readable.end();
    await connected;
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio ToolError code serialization > serializes an infinite public tool error code as null on the wire
```

## Observed Behavior

`ToolError` accepts an unrestricted `number` code in `packages/tiny-stdio-mcp-server/src/types.ts:31` through `packages/tiny-stdio-mcp-server/src/types.ts:38` and is re-exported publicly at `packages/tiny-stdio-mcp-server/src/index.ts:50`. When a tool handler throws one, `createServer()` copies its code directly into a JSON-RPC error result at `packages/tiny-stdio-mcp-server/src/server.ts:137` through `packages/tiny-stdio-mcp-server/src/server.ts:149`. The stdio response path serializes that error via `formatErrorResponse()` at `packages/tiny-stdio-mcp-server/src/server.ts:170` through `packages/tiny-stdio-mcp-server/src/server.ts:197` and `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:124` through `packages/tiny-stdio-mcp-server/src/jsonrpc.ts:134`. JavaScript `JSON.stringify()` converts `Infinity` to `null`, so a tool error with `code: Infinity` is emitted on the wire as `{"error":{"code":null,"message":"overflow"}}`.

## Expected Behavior

Public tool error construction or server response handling should reject non-finite error codes before serialization. Every emitted JSON-RPC error response should carry a valid finite numeric `code`, rather than silently changing an invalid application-provided number into `null`.

## Impact

Tools can accidentally or maliciously produce invalid JSON-RPC error objects that clients cannot classify as numeric protocol/application errors. The server also hides the source of the invalid value by silently rewriting it during serialization, causing misleading diagnostics and compatibility failures in MCP clients expecting numeric error codes.
