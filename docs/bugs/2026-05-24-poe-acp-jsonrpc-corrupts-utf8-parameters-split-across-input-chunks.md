# Poe ACP JSON-RPC corrupts UTF-8 parameters split across input chunks

## Summary

`@poe-code/poe-acp-client` decodes each incoming `Uint8Array` transport chunk into text before assembling newline-delimited JSON-RPC messages. If a valid message is split inside a multibyte UTF-8 parameter value, the JSON remains parseable but the dispatched request parameters contain replacement characters instead of the transmitted value.

## Reproduction

Add the following temporary probe as `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcMessageLayer } from "./jsonrpc-message-layer.js";

describe("JSON-RPC UTF-8 framing", () => {
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
    const layer = new JsonRpcMessageLayer({ input, output });
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
./node_modules/.bin/vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The reproduction passes and shows altered request data arriving at the handler:

```text
{"received":{"text":"���"}}
✓ packages/poe-acp-client/src/__probe__.test.ts > JSON-RPC UTF-8 framing > delivers corrupted parameters when a valid request is split inside a code point
```

## Observed Behavior

`chunkToString()` converts each binary input chunk with `Buffer.from(chunk).toString("utf8")` before `readLines()` concatenates it into the buffered JSON-RPC line. Splitting the four UTF-8 bytes for `🧪` across two yielded input chunks causes each incomplete decode to insert replacement characters. The resulting JSON line is syntactically valid, so `JsonRpcMessageLayer` dispatches an `echo` request containing `{ text: "���" }` rather than reporting corruption or preserving `{ text: "🧪" }`.

## Expected Behavior

The JSON-RPC transport should decode valid UTF-8 stream data incrementally and dispatch parameter values byte-for-byte equivalent to the sender's message, regardless of input chunk boundaries. Incomplete trailing byte sequences must be buffered until continuation bytes arrive.

## Impact

ACP agents and clients can silently receive altered prompts, tool arguments, file paths, status messages, or model output whenever protocol messages contain non-ASCII characters split by transport chunking. Because the damaged JSON still parses and handlers run successfully, this produces undetected semantic corruption at the protocol boundary.
