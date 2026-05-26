# Poe ACP JSON-RPC awaits handlers inline and deadlocks responses

## Summary

`JsonRpcMessageLayer` reads incoming JSON-RPC lines in a single loop and awaits each notification or request handler before reading the next line. A slow notification handler blocks unrelated response delivery, and a request handler that sends an outbound request then awaits its response deadlocks permanently because the response line cannot be processed until the handler returns.

## Reproduction

From the repository root, run disposable Vitest probes for both observable consequences of inline handler dispatch:

```sh
cat > /tmp/poe-acp-jsonrpc-handler-blocking-probe.test.ts <<'EOF'
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { JsonRpcMessageLayer } from "./jsonrpc-message-layer.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
function createLayer() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => { written += String(chunk); });
  return { input, getWritten: () => written, layer: new JsonRpcMessageLayer({ input, output }) };
}
describe("serial JSON-RPC dispatch", () => {
  it("blocks a response behind an unresolved notification handler", async () => {
    const { input, layer } = createLayer();
    const release = deferred<void>();
    layer.onNotification("slow", async () => { await release.promise; });
    const pending = layer.sendRequest("client/request");
    let settled = false;
    pending.then(() => { settled = true; });
    input.write('{"jsonrpc":"2.0","method":"slow"}\n{"jsonrpc":"2.0","id":1,"result":"ok"}\n');
    await new Promise((resolve) => setImmediate(resolve));
    console.log(`response_settled_while_notification_pending=${settled}`);
    expect(settled).toBe(false);
    release.resolve();
    await expect(pending).resolves.toBe("ok");
  });

  it("deadlocks a request handler that awaits an outbound request response", async () => {
    const { input, getWritten, layer } = createLayer();
    let handlerSettled = false;
    layer.onRequest("server/callback", async () => {
      const value = await layer.sendRequest("client/lookup");
      handlerSettled = true;
      return value;
    });
    input.write('{"jsonrpc":"2.0","id":"callback","method":"server/callback"}\n');
    await vi.waitFor(() => expect(getWritten()).toContain('"method":"client/lookup"'));
    input.write('{"jsonrpc":"2.0","id":1,"result":"answer"}\n');
    await new Promise((resolve) => setImmediate(resolve));
    console.log(JSON.stringify({ written: getWritten().trim().split("\n"), handlerSettled }));
    expect(handlerSettled).toBe(false);
    expect(getWritten()).not.toContain('"id":"callback","result":"answer"');
    layer.dispose(new Error("probe cleanup"));
  });
});
EOF
cp /tmp/poe-acp-jsonrpc-handler-blocking-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/jsonrpc-message-layer.ts | sed -n '473,565p'
```

## Observed Behavior

An unresolved notification delays a response that has already arrived, and an inbound request handler awaiting its own outbound request response never settles:

```text
response_settled_while_notification_pending=false
{"written":["{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"client/lookup\"}"],"handlerSettled":false}
```

The input loop in `packages/poe-acp-client/src/jsonrpc-message-layer.ts:473` through `packages/poe-acp-client/src/jsonrpc-message-layer.ts:495` awaits `handleIncomingLine(line)` for every line. That method awaits notification handlers through `packages/poe-acp-client/src/jsonrpc-message-layer.ts:510` through `packages/poe-acp-client/src/jsonrpc-message-layer.ts:512` and awaits request handlers through `packages/poe-acp-client/src/jsonrpc-message-layer.ts:534` through `packages/poe-acp-client/src/jsonrpc-message-layer.ts:549`, preventing later response lines from reaching `handleResponse()` while an earlier handler remains pending.

## Expected Behavior

Inbound response correlation must continue independently of slow request/notification handler completion. In particular, an inbound request handler must be able to issue and await a nested outbound JSON-RPC request without preventing its response from being processed.

## Impact

A valid agent notification callback can stall every pending client request, and a valid re-entrant request-handler workflow can deadlock the ACP connection entirely. Features that require client callbacks, permission prompts, terminal/fs handling, or extension RPCs can become permanently unresponsive under normal protocol interactions.
