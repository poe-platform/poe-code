# Tiny HTTP MCP server notifications omit event IDs so the client does not reconnect after stream close

## Summary

The bundled `tiny-http-mcp-server` emits SSE notifications without event IDs, while the bundled `tiny-mcp-client` only automatically reopens a completed session stream after it has observed a `Last-Event-ID` value. As a result, a normal stream close after delivering a server notification silently ends notification delivery until some later application request happens to open a new stream.

## Reproduction

From the repository root, simulate the server's ID-less SSE notification format and compare it with the same event carrying an ID:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-sse-reconnect-probe.XXXXXX)

cat > "$probe/no-id.mjs" <<'EOF'
import { HttpTransport } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const encoder = new TextEncoder();
let getCalls = 0;
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "POST") {
      return new Response("", { status: 202, headers: { "Mcp-Session-Id": "session-1" } });
    }
    if (method === "GET") {
      getCalls += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n'
          ));
          controller.close();
        }
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (method === "DELETE") {
      return new Response("", { status: 204 });
    }
    throw new Error(`unexpected ${method}`);
  }
});

let output = "";
transport.readable.on("data", (chunk) => { output += String(chunk); });
transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 50));
console.log(`output=${output.trim()}`);
console.log(`getCalls=${getCalls}`);
transport.dispose();
EOF

cat > "$probe/with-id.mjs" <<'EOF'
import { HttpTransport } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const encoder = new TextEncoder();
let getCalls = 0;
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "POST") {
      return new Response("", { status: 202, headers: { "Mcp-Session-Id": "session-1" } });
    }
    if (method === "GET") {
      getCalls += 1;
      if (getCalls > 1) return new Response("", { status: 405 });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'id: evt-1\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n'
          ));
          controller.close();
        }
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (method === "DELETE") return new Response("", { status: 204 });
    throw new Error(`unexpected ${method}`);
  }
});

transport.readable.on("data", () => {});
transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 50));
console.log(`getCallsWithId=${getCalls}`);
transport.dispose();
EOF

node "$probe/no-id.mjs"
node "$probe/with-id.mjs"

nl -ba packages/tiny-http-mcp-server/src/http-transport.ts | sed -n '44,55p'
nl -ba packages/tiny-http-mcp-server/src/sse.ts | sed -n '13,34p'
nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2559,2581p'
```

## Observed Behavior

An ID-less server-format notification is delivered once, then the closed stream is not automatically reopened. Adding an event ID causes the client to issue a replacement `GET` request:

```text
output={"jsonrpc":"2.0","method":"notifications/tools/list_changed"}
getCalls=1
getCallsWithId=2
```

`packages/tiny-http-mcp-server/src/http-transport.ts:45` through `packages/tiny-http-mcp-server/src/http-transport.ts:54` call `formatSseEvent()` with only `data`, and `packages/tiny-http-mcp-server/src/sse.ts:16` through `packages/tiny-http-mcp-server/src/sse.ts:18` emit an `id:` line only when the caller supplies one. On the client, `packages/tiny-mcp-client/src/internal.ts:2576` through `packages/tiny-mcp-client/src/internal.ts:2579` reconnect only when `lastEventId !== undefined`, so streams produced by the bundled server cannot recover after a clean disconnect.

## Expected Behavior

The server and client transport implementations should interoperate for stream reconnects. Either emitted session events should carry resumable SSE IDs, or the client should reopen a closed stream even when no resumable event ID is available, without silently ending notification delivery.

## Impact

Any ordinary network disconnect, proxy stream rotation, or server-side stream close after a notification can disable subsequent notifications for an otherwise idle active `tiny-http-mcp-server` / `tiny-mcp-client` session until another application request causes stream setup to run again. Clients may miss tool-list changes and other server-originated events without an error or reconnect attempt.
