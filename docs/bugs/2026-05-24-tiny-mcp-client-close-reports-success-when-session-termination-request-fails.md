# Tiny MCP client close reports success when session termination request fails

## Summary

The exported HTTP transport in `tiny-mcp-client` sends a best-effort `DELETE` request when closing an established MCP session, but ignores all non-`405` failure responses and resolves its `closed` promise as normal disposal. A server-side session can remain active after the client reports that it has closed.

## Reproduction

From the repository root, create an HTTP transport whose mock server establishes a session but returns HTTP 500 to the session-termination `DELETE` request:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-session-delete-failure-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { HttpTransport } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

let sessionActive = false;
const requests = [];
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    const method = init.method ?? "GET";
    const sessionId = new Headers(init.headers).get("Mcp-Session-Id");
    requests.push(`${method}:${sessionId ?? "<none>"}`);
    if (method === "POST") {
      sessionActive = true;
      return new Response("", { status: 202, headers: { "Mcp-Session-Id": "session-1" } });
    }
    if (method === "GET") {
      return new Response("", { status: 405 });
    }
    if (method === "DELETE") {
      return new Response("server refused cleanup", { status: 500 });
    }
    throw new Error(`unexpected ${method}`);
  }
});

transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 20));
transport.dispose();
const closed = await transport.closed;
await new Promise((resolve) => setTimeout(resolve, 20));
console.log(`closed=${closed.reason.message}`);
console.log(`requests=${requests.join(",")}`);
console.log(`sessionActive=${sessionActive}`);
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2397,2417p;2537,2557p'
```

## Observed Behavior

The transport issues a termination request that the server rejects, but `closed` still resolves as routine disposal while the simulated remote session remains live:

```text
closed=HTTP transport disposed
requests=POST:<none>,GET:session-1,DELETE:session-1
sessionActive=true
```

`packages/tiny-mcp-client/src/internal.ts:2397` through `packages/tiny-mcp-client/src/internal.ts:2417` resolves closure immediately after invoking `terminateSession()`. `packages/tiny-mcp-client/src/internal.ts:2537` through `packages/tiny-mcp-client/src/internal.ts:2546` explicitly discards any termination failure, and `packages/tiny-mcp-client/src/internal.ts:2548` through `packages/tiny-mcp-client/src/internal.ts:2557` handles only HTTP 405 while silently accepting HTTP 500 and other failed cleanup responses.

## Expected Behavior

When a transport has created a stateful MCP session, closing it should either wait for successful session termination or surface that termination failed. A failed `DELETE` response must not be indistinguishable from a successfully closed remote session.

## Impact

Servers may retain orphaned MCP sessions, open resources, or session-scoped state after applications believe cleanup succeeded. Automation and tests cannot detect failed teardown, and long-running servers can accumulate abandoned sessions after transient or authorization-related termination failures.
