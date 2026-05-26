# Tiny stdio MCP server accepts initialized notification before initialize request

## Summary

`tiny-stdio-mcp-server` accepts `notifications/initialized` before it has received any `initialize` request. The server acknowledges the out-of-order lifecycle notification as a successful no-response operation rather than rejecting or ignoring an invalid client sequence, even though it still considers itself uninitialized for later requests.

## Reproduction

From the repository root, run a disposable Vitest probe that sends `notifications/initialized` to a new server before sending `initialize`:

```sh
cat > /tmp/tiny-stdio-mcp-initialized-order-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("tiny stdio MCP initialized ordering", () => {
  it("accepts notifications/initialized before any initialize request", async () => {
    const server = createServer({ name: "probe", version: "1" });
    const notification = await server.handleMessage("notifications/initialized", {});
    const tools = await server.handleMessage("tools/list", {});
    console.log(JSON.stringify({ notification, tools }));
    expect(notification).toEqual({ result: undefined });
    expect(tools).toMatchObject({ error: { message: "Server not initialized" } });
  });
});
EOF
cp /tmp/tiny-stdio-mcp-initialized-order-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The lifecycle notification is accepted before initialization, while the next ordinary request confirms the server remains uninitialized:

```text
{"notification":{},"tools":{"error":{"code":-32600,"message":"Server not initialized"}}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP initialized ordering > accepts notifications/initialized before any initialize request
```

`packages/tiny-stdio-mcp-server/src/server.ts:61` through `packages/tiny-stdio-mcp-server/src/server.ts:99` handle `notifications/initialized` before the uninitialized-state rejection and return success without verifying that an initialization request occurred first.

## Expected Behavior

The server should enforce the MCP lifecycle order: `notifications/initialized` is valid only after a successful `initialize` exchange, and an out-of-order notification should not be treated as an accepted lifecycle step.

## Impact

The server silently accepts invalid client handshakes and provides no feedback for a lifecycle sequencing error. Clients or tests can appear to complete initialization acknowledgement while the server remains unable to operate, leading to confusing follow-on failures.
