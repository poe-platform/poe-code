# Poe ACP client allows session operations after dispose

## Summary

`AcpClient.dispose()` records `this.disposed = true`, fails current prompt streams, and optionally disposes the backing transport, but normal client operations never check that disposed flag. With an injected or still-callable transport, a disposed client continues to issue `session/new`, `session/cancel`, and `session/prompt` operations successfully.

## Reproduction

From the repository root, run a disposable Vitest probe using an injected callable transport with no transport-level disposal hook:

```sh
cat > /tmp/poe-acp-client-dispose-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
describe("client disposal", () => {
  it("still invokes requests and notifications after dispose", async () => {
    const transport = {
      sendRequest: vi.fn((method: string) => Promise.resolve(
        method === "initialize" ? { protocolVersion: 1 } :
        method === "session/new" ? { sessionId: "s-1" } :
        { stopReason: "completed" }
      )),
      sendNotification: vi.fn(),
      onRequest: vi.fn(),
      onNotification: vi.fn()
    };
    const client = new AcpClient({ transport });
    await client.initialize();
    await client.dispose();
    const session = await client.newSession("/tmp", []);
    await client.cancelSession("s-1");
    const turn = client.prompt("s-1", [{ type: "text", text: "after close" }]);
    await turn.response;
    console.log(JSON.stringify({
      session,
      methods: transport.sendRequest.mock.calls.map(([method]) => method),
      notifications: transport.sendNotification.mock.calls
    }));
    expect(transport.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      "initialize", "session/new", "session/prompt"
    ]);
    expect(transport.sendNotification).toHaveBeenCalledWith("session/cancel", { sessionId: "s-1" });
  });
});
EOF
cp /tmp/poe-acp-client-dispose-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '303,305p;447,553p;603,637p'
```

## Observed Behavior

After disposal, the same client successfully creates a session, sends a cancellation notification, and starts a prompt:

```text
{"session":{"sessionId":"s-1"},"methods":["initialize","session/new","session/prompt"],"notifications":[["session/cancel",{"sessionId":"s-1"}]]}
✓ packages/poe-acp-client/src/__probe__.test.ts > client disposal > still invokes requests and notifications after dispose when transport remains callable
```

The disposed flag is declared in `packages/poe-acp-client/src/acp-client.ts:303` and set by `dispose()` in `packages/poe-acp-client/src/acp-client.ts:603` through `packages/poe-acp-client/src/acp-client.ts:624`. However, operational readiness checks in `packages/poe-acp-client/src/acp-client.ts:627` through `packages/poe-acp-client/src/acp-client.ts:637` consider only lifecycle initialization/authentication state, and the session operations in `packages/poe-acp-client/src/acp-client.ts:447` through `packages/poe-acp-client/src/acp-client.ts:553` do not reject disposed clients.

## Expected Behavior

Once `dispose()` completes, all subsequent protocol operations on that client instance should reject immediately without sending requests or notifications through the transport.

## Impact

Consumers can accidentally reuse a terminated ACP client and start new agent work after teardown, cancellation, or resource cleanup. With injected transports or transports that have not yet closed, this defeats lifecycle boundaries and can send prompts or cancellation messages after an owning operation considers the client dead.
