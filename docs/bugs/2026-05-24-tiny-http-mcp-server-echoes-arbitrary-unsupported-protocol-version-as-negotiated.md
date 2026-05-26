# Tiny HTTP MCP server echoes an arbitrary unsupported protocol version as negotiated

## Summary

The bundled MCP server defines an implemented protocol version but replies to `initialize` using any client-supplied `protocolVersion` string verbatim. A client can request a nonsensical or unsupported protocol identifier and receive a successful session claiming that exact identifier was negotiated, even though the server does not implement a version-specific path for it.

## Reproduction

From the repository root, send an initialize request carrying a protocol identifier that is not an MCP revision supported by the server:

```sh
cat > /tmp/tiny-http-accepts-unsupported-protocol-version-probe.mjs <<'EOF'
import { createHttpServer, nodeFetch } from "/Users/kjopek/Workspace/poe-code/packages/tiny-http-mcp-server/dist/index.js";

const server = createHttpServer({ name: "probe", version: "1", enableJsonResponse: true });
const handle = await server.listenHttp({ port: 0 });
try {
  const response = await nodeFetch(handle.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "not-a-supported-version" }
    })
  });
  console.log(`status=${response.status}`);
  console.log(`session=${response.headers.get("mcp-session-id")}`);
  console.log(`body=${await response.text()}`);
} finally {
  await handle.close();
}
EOF

node /tmp/tiny-http-accepts-unsupported-protocol-version-probe.mjs

nl -ba packages/tiny-stdio-mcp-server/src/server.ts | sed -n '26,30p;61,85p'
```

## Observed Behavior

The server accepts the invalid requested version, creates a session, and returns it as the successful negotiated protocol version:

```text
status=200
session=b1fd9d01-ac69-433c-bb3c-ba03685702ae
body={"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"not-a-supported-version","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"probe","version":"1"}}}
```

The MCP lifecycle specification requires a server to return the requested version only when it supports that version; otherwise it must return another version that it supports. `packages/tiny-stdio-mcp-server/src/server.ts:27` declares the server's protocol revision, but `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:84` assign `requestedProtocol ?? PROTOCOL_VERSION` without validating the requested value or selecting the implemented version when it is unsupported.

## Expected Behavior

When a client requests a protocol version the server does not support, the initialize result should identify a protocol version the server actually implements, or initialization should fail. It must not affirm an arbitrary input string as a negotiated protocol revision.

## Impact

Clients can be told that they established a session under a protocol revision that does not exist or is not implemented by the server. This breaks version negotiation, causes incompatible clients to continue when they should disconnect or downgrade, and prevents callers from relying on the initialize result to determine wire behavior.
