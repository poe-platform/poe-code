# Tiny MCP client silently switches to a response-supplied session ID mid-session

## Summary

The exported `tiny-mcp-client` HTTP transport overwrites its active `Mcp-Session-Id` with any non-empty session ID present on any later response. Once a session is established, a mismatched response header silently redirects subsequent requests into another server session instead of being rejected as a protocol violation.

## Reproduction

From the repository root, create a transport whose initialization response establishes one session ID and whose next response returns a different session ID:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-session-id-switch-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { HttpTransport } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const sent = [];
let postCount = 0;
const transport = new HttpTransport({
  url: "https://resource.example.test/mcp",
  fetch: async (_url, init = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    sent.push(`${method}:${headers.get("Mcp-Session-Id") ?? "<none>"}`);
    if (method === "GET") return new Response("", { status: 405 });
    if (method === "DELETE") return new Response("", { status: 204 });
    postCount += 1;
    return new Response("", {
      status: 202,
      headers: {
        "Mcp-Session-Id": postCount === 1 ? "original-session" : "attacker-session"
      }
    });
  }
});

transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
await new Promise((resolve) => setTimeout(resolve, 20));
transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
await new Promise((resolve) => setTimeout(resolve, 20));
transport.writable.write('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');
await new Promise((resolve) => setTimeout(resolve, 20));
console.log(`sent=${sent.join(",")}`);
transport.dispose();
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '2450,2484p;2513,2520p'
```

## Observed Behavior

After the second `POST` response supplies a different session ID, the third application request is sent under that replacement ID without an error:

```text
sent=POST:<none>,GET:original-session,POST:original-session,POST:attacker-session
```

`packages/tiny-mcp-client/src/internal.ts:2456` through `packages/tiny-mcp-client/src/internal.ts:2472` processes every successful response and invokes `captureSessionId()`. `packages/tiny-mcp-client/src/internal.ts:2513` through `packages/tiny-mcp-client/src/internal.ts:2520` unconditionally assigns any returned non-empty header to `this.sessionId`, without checking whether an established session already exists or whether the returned value matches it.

## Expected Behavior

Once the initialization response establishes a stateful HTTP session, later responses should either omit `Mcp-Session-Id` or repeat that same identifier. A conflicting session ID must close the transport or produce a protocol error rather than transparently moving future requests into a different session.

## Impact

A faulty, compromised, or confused MCP endpoint can redirect a live client's future calls and eventual termination request into a different session context. This undermines session isolation, can expose operations to state owned by another interaction, and can leave the original session orphaned on the server.
