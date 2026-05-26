# Tiny MCP client GET stream 404 does not close an expired session

## Summary

The exported `tiny-mcp-client` HTTP transport recognizes an MCP session-expired HTTP 404 only on subsequent `POST` responses. If the asynchronous session `GET` stream receives HTTP 404 because the server has already deleted or expired the session, the transport silently returns from its stream reader and remains open with the dead session ID cached.

## Reproduction

From the repository root, establish a stateful HTTP transport session and return HTTP 404 only for its automatically opened `GET` event stream:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-get-session-404-probe.XXXXXX)

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
      return new Response("", { status: 404 });
    }
    if (method === "DELETE") {
      return new Response("", { status: 204 });
    }
    throw new Error(`unexpected ${method}`);
  }
});

transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 30));
const closed = await Promise.race([
  transport.closed.then((event) => `closed:${event.reason.message}`),
  new Promise((resolve) => setTimeout(() => resolve("still-open"), 20))
]);
console.log(`closed=${closed}`);
console.log(`requests=${requests.join(",")}`);
transport.dispose();
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2450,2473p;2559,2581p'
```

## Observed Behavior

The server rejects the session's stream attachment with HTTP 404, but the transport remains open rather than reporting that its MCP session no longer exists:

```text
closed=still-open
requests=POST,GET
```

`packages/tiny-mcp-client/src/internal.ts:2463` through `packages/tiny-mcp-client/src/internal.ts:2466` explicitly dispose the transport with `HTTP transport session expired` only when an already-session-bound `POST` returns HTTP 404. The analogous `GET` path in `packages/tiny-mcp-client/src/internal.ts:2559` through `packages/tiny-mcp-client/src/internal.ts:2581` handles HTTP 405 but otherwise treats a bodyless HTTP 404 as a normal completed stream, leaving the session ID and open transport state intact.

## Expected Behavior

HTTP 404 on any request carrying an established `Mcp-Session-Id`, including the background `GET` stream, should invalidate the local session and close or reconnect the transport consistently. A deleted remote session must not leave the client believing it remains connected.

## Impact

Clients can silently lose asynchronous notification streams after server-side expiration or deletion while retaining a dead local connection state. Subsequent behavior becomes inconsistent: notifications stop without an error, and only a later write may eventually reveal that the session was already gone.
