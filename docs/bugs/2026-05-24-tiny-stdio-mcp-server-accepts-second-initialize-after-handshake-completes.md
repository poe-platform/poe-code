# Tiny stdio MCP server accepts second initialize after handshake completes

## Summary

`tiny-stdio-mcp-server` accepts a second `initialize` request even after it has already answered `initialize` and received `notifications/initialized`. Initialization is a one-time lifecycle handshake; accepting it again permits a connected client to renegotiate server initialization state instead of rejecting an invalid post-handshake request.

## Reproduction

From the repository root, run a disposable Vitest probe that completes the initialization handshake and then sends another `initialize` request on the same server instance:

```sh
cat > /tmp/tiny-stdio-mcp-repeat-initialize-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("tiny stdio MCP repeat initialize", () => {
  it("accepts a second initialize request after completing initialization", async () => {
    const server = createServer({ name: "probe", version: "1" });
    const first = await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await server.handleMessage("notifications/initialized", {});
    const second = await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    console.log(JSON.stringify({ first, second }));
    expect(second).toEqual(first);
  });
});
EOF
cp /tmp/tiny-stdio-mcp-repeat-initialize-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

After completing the first handshake, the server returns another ordinary initialization response to the second request:

```text
{"first":{"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"probe","version":"1"}}},"second":{"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"probe","version":"1"}}}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP repeat initialize > accepts a second initialize request after completing initialization
```

`packages/tiny-stdio-mcp-server/src/server.ts:55` through `packages/tiny-stdio-mcp-server/src/server.ts:85` keep only a boolean initialized state and process every incoming `initialize` request identically, without rejecting subsequent initialization attempts after the lifecycle handshake has completed.

## Expected Behavior

Once a connection has completed initialization, a second `initialize` request should be rejected as an invalid request rather than accepted as a fresh handshake.

## Impact

Malformed or buggy clients can repeatedly renegotiate a supposedly settled connection lifecycle without an error. This obscures protocol violations and can cause inconsistent capability or version expectations in transports built around this server implementation.
