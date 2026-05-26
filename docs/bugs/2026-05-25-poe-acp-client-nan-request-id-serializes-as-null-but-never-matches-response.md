# Poe Acp Client Nan Request Id Serializes As Null But Never Matches Response

## Summary

`@poe-code/poe-acp-client` lets callers supply any numeric JSON-RPC request ID through `JsonRpcMessageLayer.sendRequest(..., { id })` without checking that it is finite. Passing `Number.NaN` stores the pending request under a `NaN` map key, but JSON serialization emits the outbound ID as `null`; a valid server response for wire ID `null` is then ignored and the request remains pending indefinitely.

## Reproduction

Create a disposable probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcMessageLayer } from "./jsonrpc-message-layer.js";

describe("JSON-RPC non-finite request id probe", () => {
  it("sends NaN as null but cannot match the null response", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.setEncoding("utf8");
    output.on("data", (chunk) => written.push(String(chunk)));
    const layer = new JsonRpcMessageLayer({ input, output });

    let settled = false;
    const pending = layer.sendRequest("ping", undefined, { id: Number.NaN }).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(written.join("")).toContain('"id":null');
    input.write('{"jsonrpc":"2.0","id":null,"result":"pong"}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(layer.pendingRequestCount()).toBe(1);
    expect(settled).toBe(false);

    layer.dispose();
    await expect(pending).rejects.toThrow("JSON-RPC message layer disposed");
    input.destroy();
    output.destroy();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
```

The probe passes: the outgoing line includes `"id":null`, the corresponding `null` response does not settle the pending promise, and disposal is required to reject the stranded request. Remove the disposable probe afterward.

## Observed Behavior

`sendRequest("ping", undefined, { id: Number.NaN })` transmits a JSON-RPC request whose serialized ID is `null`, because JSON converts non-finite numeric values to `null`. Internally, however, the pending map remains keyed by `NaN`, so `handleResponse({ id: null, result: "pong" })` finds no matching request and silently ignores a valid response.

## Expected Behavior

Caller-supplied request IDs should be validated against the JSON-RPC-compatible runtime representation before a request is registered or written. Non-finite numeric IDs should be rejected immediately, or the exact serialized value should be the key used for response correlation so a transmitted request can always settle.

## Impact

SDK consumers that derive numeric IDs from calculations, parsed configuration, or instrumentation data can create ACP requests that the server successfully answers but the client never resolves. Sessions may hang waiting for initialization, authentication, permissions, terminal operations, or extension calls until externally cancelled or disposed, with the original wire response silently discarded.
