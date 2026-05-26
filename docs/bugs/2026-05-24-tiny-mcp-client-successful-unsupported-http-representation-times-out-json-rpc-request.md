# Tiny MCP client successful unsupported HTTP representation times out the JSON-RPC request

## Summary

The exported `tiny-mcp-client` HTTP transport treats an HTTP 2xx response with an unsupported representation, such as `text/plain`, as successful transport completion but emits no JSON-RPC input and surfaces no protocol error. The associated request remains pending until its JSON-RPC timeout expires instead of failing immediately on the invalid server response.

## Reproduction

From the repository root, pair the exported HTTP transport with the exported JSON-RPC layer and return HTTP 200 with a non-MCP response content type:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-unsupported-representation-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { HttpTransport, JsonRpcMessageLayer } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const methods = [];
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    methods.push(init.method ?? "GET");
    return new Response("not a JSON-RPC representation", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
});
const layer = new JsonRpcMessageLayer(
  transport.readable,
  transport.writable,
  30,
  transport.closed.then((event) => event.reason)
);

const started = Date.now();
try {
  await layer.sendRequest("ping");
  console.log("resolved=true");
} catch (error) {
  console.log(`error=${error.message}`);
  console.log(`elapsedAtLeastTimeout=${Date.now() - started >= 25}`);
  console.log(`methods=${methods.join(",")}`);
}
layer.dispose();
transport.dispose();
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2583,2649p;3086,3130p'
```

## Observed Behavior

The transport receives an immediate HTTP 200 response, but the caller learns only that the JSON-RPC request eventually timed out:

```text
error=JSON-RPC request "ping" timed out after 30ms
elapsedAtLeastTimeout=true
methods=POST
```

`packages/tiny-mcp-client/src/internal.ts:2583` through `packages/tiny-mcp-client/src/internal.ts:2594` reject only HTTP error status codes. `packages/tiny-mcp-client/src/internal.ts:2635` through `packages/tiny-mcp-client/src/internal.ts:2648` forward successful bodies only for `text/event-stream` or `application/json`, silently dropping a successful `text/plain` representation. The pending request consequently survives until the timer in `packages/tiny-mcp-client/src/internal.ts:3086` through `packages/tiny-mcp-client/src/internal.ts:3130` rejects it.

## Expected Behavior

For a JSON-RPC request, a successful HTTP response that is neither a supported JSON response nor an SSE response should immediately fail as an invalid MCP HTTP response, including its unsupported content type. It should not be indistinguishable from a server that never replied.

## Impact

Misconfigured or malfunctioning MCP endpoints turn immediate protocol violations into long request hangs, including the default 30-second request timeout used during `McpClient.connect()`. Users receive misleading timeout errors and applications lose fast failure and actionable diagnostics.
