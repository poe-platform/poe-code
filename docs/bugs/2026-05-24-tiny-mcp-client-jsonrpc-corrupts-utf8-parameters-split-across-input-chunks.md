# Tiny MCP client JSON-RPC corrupts UTF-8 parameters split across input chunks

## Summary

`tiny-mcp-client` decodes each incoming binary JSON-RPC transport chunk into a JavaScript string before joining newline-delimited messages. A valid MCP request split inside a multibyte UTF-8 parameter value is therefore dispatched with replacement characters instead of the transmitted data.

## Reproduction

Add the following temporary probe as `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcMessageLayer } from "./internal.js";

describe("tiny MCP JSON-RPC UTF-8 framing", () => {
  it("delivers corrupted parameters when a valid request is split inside a code point", async () => {
    const message = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"🧪"}}\n', "utf8");
    const marker = Buffer.from("🧪", "utf8");
    const splitStart = message.indexOf(marker) + 2;
    const input = Readable.from((async function* () {
      yield message.subarray(0, splitStart);
      await Promise.resolve();
      yield message.subarray(splitStart);
    })());
    const output = new PassThrough();
    const layer = new JsonRpcMessageLayer(input, output);
    let received: unknown;
    layer.onRequest("echo", (params) => {
      received = params;
      return { ok: true };
    });

    await new Promise<void>((resolve) => output.once("data", () => resolve()));
    console.log(JSON.stringify({ received }));
    expect(received).toEqual({ text: "���" });
    expect(received).not.toEqual({ text: "🧪" });
    layer.dispose();
  });
});
```

Run the probe and then remove it:

```sh
./node_modules/.bin/vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-mcp-client/src/__probe__.test.ts
```

The reproduction passes and records corrupted handler input:

```text
{"received":{"text":"���"}}
✓ packages/tiny-mcp-client/src/__probe__.test.ts > tiny MCP JSON-RPC UTF-8 framing > delivers corrupted parameters when a valid request is split inside a code point
```

## Observed Behavior

The `readLines()` utility uses `chunkToString()` to perform `Buffer.from(chunk).toString("utf8")` separately for every binary input chunk, then concatenates the already-decoded strings. `JsonRpcMessageLayer.consumeInput()` parses and dispatches each resulting line. When `🧪` is split across two chunks, the request remains valid JSON but reaches its handler as `{ text: "���" }`.

## Expected Behavior

The MCP JSON-RPC layer should use incremental UTF-8 decoding so transport chunking cannot change the semantic contents of valid protocol messages. A request transmitted with `{ text: "🧪" }` must be delivered with that exact parameter value even when bytes arrive in multiple chunks.

## Impact

Clients and servers using `tiny-mcp-client` transports can silently corrupt prompts, tool arguments, resource URIs, progress text, or returned data containing non-ASCII characters. Because processing continues successfully after mutation, protocol consumers may act on wrong data without receiving an error.
