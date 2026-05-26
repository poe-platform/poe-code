# Tiny HTTP MCP server initialized session enables pre-initialize requests in a new session

## Summary

The stateful HTTP MCP server records initialization in both its per-session store and the underlying shared server instance, but request dispatch checks only the shared server-level flag. After one client initializes, a new session can execute ordinary MCP methods before its own `initialize` message by including a later `initialize` message in the same batch solely to obtain a session ID.

## Reproduction

From the repository root, initialize one session, then make a new session request containing `tools/list` before `initialize` in the same JSON-RPC batch:

```sh
probe=$(mktemp -d /tmp/tiny-http-cross-session-initialize-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { createTestMcpServer, nodeFetch } from "/Users/kjopek/Workspace/poe-code/packages/tiny-http-mcp-server/dist/index.js";

const nextSessionId = (() => {
  let counter = 0;
  return () => `session-${++counter}`;
})();
const handle = await createTestMcpServer({
  enableJsonResponse: true,
  sessionIdGenerator: nextSessionId
}).listenHttp({ port: 0, hostname: "127.0.0.1" });

async function post(body, sessionId) {
  return nodeFetch(handle.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
    },
    body: JSON.stringify(body)
  });
}

try {
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  console.log(`session_a=${initialized.headers.get("mcp-session-id")}`);

  const newSession = await post([
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "initialize", params: {} }
  ]);
  console.log(`session_b=${newSession.headers.get("mcp-session-id")}`);
  console.log(`session_b_body=${await newSession.text()}`);
} finally {
  await handle.close();
}
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-stdio-mcp-server/src/server.ts | sed -n '50,105p'
nl -ba packages/tiny-http-mcp-server/src/http-transport.ts | sed -n '118,177p'
```

## Observed Behavior

The first item executed in `session-2` is `tools/list`, preceding that session's `initialize` request, but it succeeds and returns the full tool catalog:

```text
session_a=session-1
session_b=session-2
session_b_body=[{"jsonrpc":"2.0","id":2,"result":{"tools":[...] }},{"jsonrpc":"2.0","id":3,"result":{"protocolVersion":"2025-11-25",...}}]
```

`packages/tiny-stdio-mcp-server/src/server.ts:55` through `packages/tiny-stdio-mcp-server/src/server.ts:99` maintain one module-instance `initialized` boolean for all HTTP sessions. Although `packages/tiny-http-mcp-server/src/http-transport.ts:132` through `packages/tiny-http-mcp-server/src/http-transport.ts:159` allocate and mark individual sessions, the transport dispatches each batch message through the already-initialized shared server at `packages/tiny-http-mcp-server/src/http-transport.ts:145` through `packages/tiny-http-mcp-server/src/http-transport.ts:173` without enforcing the new session's own initialization status before earlier messages run.

## Expected Behavior

Each stateful MCP HTTP session should independently complete `initialize` before that session may invoke methods such as `tools/list` or `tools/call`. A prior client's initialization must not authorize pre-initialize messages in a newly allocated session, including messages appearing earlier in the same batch as its `initialize` request.

## Impact

The server's session isolation contract is bypassed once any client has initialized. New connections can run method calls before completing their own negotiated handshake, which can expose capabilities or execute tools without per-session initialization sequencing and may allow one client's lifecycle state to influence another client's requests.
