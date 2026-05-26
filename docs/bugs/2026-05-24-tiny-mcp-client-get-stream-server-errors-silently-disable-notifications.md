# Tiny MCP client GET stream server errors silently disable notifications

## Summary

The exported `tiny-mcp-client` HTTP transport opens a background `GET` stream after receiving a session ID, but does not reject or close the transport when that stream request returns an HTTP server error. An HTTP 500 response therefore silently disables server-to-client notifications while the client remains reported as open.

## Reproduction

From the repository root, establish a transport session and make the automatically opened stream request return HTTP 500:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-get-stream-500-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { HttpTransport } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const requests = [];
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    const method = init.method ?? "GET";
    requests.push(method);
    if (method === "POST") {
      return new Response("", { status: 202, headers: { "Mcp-Session-Id": "session-1" } });
    }
    if (method === "GET") {
      return new Response("stream failed", { status: 500 });
    }
    if (method === "DELETE") {
      return new Response("", { status: 204 });
    }
    throw new Error(`unexpected ${method}`);
  }
});

transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 30));
const state = await Promise.race([
  transport.closed.then((event) => `closed:${event.reason.message}`),
  new Promise((resolve) => setTimeout(() => resolve("still-open"), 20))
]);
console.log(`state=${state}`);
console.log(`requests=${requests.join(",")}`);
transport.dispose();
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2522,2534p;2559,2581p'
```

## Observed Behavior

The event-stream request fails with HTTP 500, but the transport remains open and exposes no failure to its owner:

```text
state=still-open
requests=POST,GET
```

`packages/tiny-mcp-client/src/internal.ts:2522` through `packages/tiny-mcp-client/src/internal.ts:2534` would dispose the transport if `consumeGetSseStream()` rejected. Instead, `packages/tiny-mcp-client/src/internal.ts:2559` through `packages/tiny-mcp-client/src/internal.ts:2581` special-case only HTTP 405 and otherwise return normally whenever a failed response does not advertise `text/event-stream`, without checking its HTTP status or surfacing its response body.

## Expected Behavior

A failed background event-stream request, including HTTP 5xx responses, should close the transport or otherwise expose a recoverable stream failure. The client should not claim to remain connected after its notification channel has failed to open.

## Impact

MCP applications can silently stop receiving notifications, progress updates, and server-originated events after transient or persistent server errors. Callers receive no closure/error signal and may keep relying on a transport whose asynchronous communication channel is already unavailable.
