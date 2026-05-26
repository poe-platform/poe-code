# Tiny MCP client long-lived POST SSE response blocks subsequent requests

## Summary

The exported `tiny-mcp-client` HTTP transport processes outbound JSON-RPC lines in a serial loop and awaits an entire SSE response body before it reads the next outbound line. If an MCP server returns a valid long-lived `text/event-stream` response to one POST request, the client can receive that request's result but cannot send any later request until the server closes the stream.

## Reproduction

From the repository root, return an open SSE response for the first JSON-RPC POST and an ordinary JSON result for the second POST:

```sh
cat > /tmp/tiny-mcp-client-post-sse-blocks-next-post-probe.mjs <<'EOF'
import { HttpTransport, JsonRpcMessageLayer } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const encoder = new TextEncoder();
const postBodies = [];
let holdOpenController;
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    if ((init.method ?? "GET") !== "POST") throw new Error(`unexpected ${init.method}`);
    postBodies.push(String(init.body));
    if (postBodies.length > 1) {
      return new Response('{"jsonrpc":"2.0","id":2,"result":"second"}', {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(new ReadableStream({
      start(controller) {
        holdOpenController = controller;
        controller.enqueue(encoder.encode(
          'data: {"jsonrpc":"2.0","id":1,"result":"first"}\n\n'
        ));
      }
    }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  }
});
const layer = new JsonRpcMessageLayer(
  transport.readable,
  transport.writable,
  40,
  transport.closed.then((event) => event.reason)
);

console.log(`first=${await layer.sendRequest("first")}`);
try {
  await layer.sendRequest("second");
  console.log("second=resolved");
} catch (error) {
  console.log(`second=${error.message}`);
}
console.log(`postCountBeforeClose=${postBodies.length}`);
holdOpenController.close();
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(`postCountAfterClose=${postBodies.length}`);
layer.dispose();
transport.dispose();
EOF

node /tmp/tiny-mcp-client-post-sse-blocks-next-post-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2450,2473p;2630,2686p;3086,3130p'
```

## Observed Behavior

The first result is received from the valid open SSE response. The second request times out without even being sent; only after the first response stream is manually closed does the transport issue its second POST:

```text
first=first
second=JSON-RPC request "second" timed out after 40ms
postCountBeforeClose=1
postCountAfterClose=2
```

`packages/tiny-mcp-client/src/internal.ts:2450` through `packages/tiny-mcp-client/src/internal.ts:2473` process written messages one at a time and await `forwardResponseMessages()` before accepting the next line. For an SSE POST response, `packages/tiny-mcp-client/src/internal.ts:2630` through `packages/tiny-mcp-client/src/internal.ts:2686` await reads until the entire response stream ends, even after the pending JSON-RPC request has already received its result. The later request remains queued in the write stream until its timeout in `packages/tiny-mcp-client/src/internal.ts:3086` through `packages/tiny-mcp-client/src/internal.ts:3130` expires.

## Expected Behavior

Receiving a valid streaming POST response should not prevent independent later JSON-RPC requests from being transmitted. The transport should continue processing outbound requests while it consumes a long-lived response stream, or otherwise provide a protocol-safe multiplexing design for streamed responses.

## Impact

An MCP server that uses the permitted streaming-response mode can make a connected client unusable after its first streamed request: that response resolves successfully, but later tool calls, pings, subscriptions, and cancellations time out without reaching the server until the original stream closes. A normal long-lived server stream therefore causes an avoidable client-side deadlock.
