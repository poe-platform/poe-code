# Poe ACP client accepts numeric session id from new session response

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient.newSession()` API promises a `NewSessionResponse` whose `sessionId` is a string, but it returns the agent's `session/new` response without validating that identifier. A malformed ACP agent can respond with a numeric session ID and the client resolves it as a successful typed session response.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/poe-acp-client/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";

describe("poe-acp-client malformed new session response", () => {
  it("resolves a numeric server session id as a typed session response", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ protocolVersion: 1 })
      .mockResolvedValueOnce({ sessionId: 17 });
    const client = new AcpClient({
      transport: {
        sendRequest,
        sendNotification: vi.fn(),
        onRequest: vi.fn(),
        onNotification: vi.fn(),
        dispose: vi.fn(),
      },
    });

    await client.initialize();

    await expect(client.newSession("/workspace", [])).resolves.toEqual({
      sessionId: 17,
    });
  });
});
EOF
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > poe-acp-client malformed new session response > resolves a numeric server session id as a typed session response
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

After a normal initialization response, the injected agent transport returns `{ sessionId: 17 }` for `session/new`. `client.newSession()` resolves successfully with that object unchanged, even though the identifier is a number rather than the string type exposed by the public ACP client contract.

`SessionId` is declared as `string`, and `NewSessionResponse.sessionId` is required to use that type in `packages/poe-acp-client/src/types.ts:288` and `packages/poe-acp-client/src/types.ts:511`. At runtime, `newSession()` checks only lifecycle and MCP-server capability state before returning `this.transport.sendRequest("session/new", ...)` directly in `packages/poe-acp-client/src/acp-client.ts:447`; it never validates the received session identifier.

## Expected Behavior

`AcpClient.newSession()` should reject malformed ACP agent responses whose required `sessionId` is not a string, rather than exposing invalid protocol data as a successful `NewSessionResponse`.

## Impact

Consumers may persist the returned session ID, interpolate it into UI or storage keys, or pass it into subsequent ACP operations assuming the documented string contract. A malformed or compromised agent can inject non-string identifiers through a successful session creation, causing downstream state collisions, invalid serialization, misleading logs, or failures far away from the protocol boundary that accepted the bad response.
