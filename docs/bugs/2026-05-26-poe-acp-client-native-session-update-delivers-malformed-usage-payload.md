# Poe ACP client native session update delivers malformed usage payload

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient.prompt()` stream promises typed native ACP `SessionUpdateNotification` values, but it forwards incoming `session/update` notifications without validating their update payload. An ACP agent can send a `usage_update` whose required numeric `used` field is a string, and prompt consumers receive that invalid value as a normal typed stream update.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/poe-acp-client/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";

describe("poe-acp-client malformed native session update", () => {
  it("delivers a string usage count as a typed prompt update", async () => {
    let sessionUpdateHandler: ((params: unknown) => void) | undefined;
    let resolvePrompt: ((value: unknown) => void) | undefined;
    const sendRequest = vi.fn(async (method: string) => {
      if (method === "initialize") {
        return { protocolVersion: 1 };
      }
      return await new Promise((resolve) => {
        resolvePrompt = resolve;
      });
    });
    const client = new AcpClient({
      transport: {
        sendRequest,
        sendNotification: vi.fn(),
        onRequest: vi.fn(),
        onNotification: vi.fn((method: string, handler: (params: unknown) => void) => {
          if (method === "session/update") {
            sessionUpdateHandler = handler;
          }
        }),
        dispose: vi.fn(),
      },
    });

    await client.initialize();
    const turn = client.prompt("session-1", [{ type: "text", text: "hello" }]);
    const iterator = turn[Symbol.asyncIterator]();

    sessionUpdateHandler?.({
      sessionId: "session-1",
      update: { sessionUpdate: "usage_update", used: "many", size: 50 },
    });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { params: { update: { used: "many" } } },
    });
    resolvePrompt?.({ stopReason: "completed" });
    await turn.response;
  });
});
EOF
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > poe-acp-client malformed native session update > delivers a string usage count as a typed prompt update
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

While a native `session/prompt` request is active, an injected ACP transport sends a `session/update` notification containing `{ sessionUpdate: "usage_update", used: "many", size: 50 }`. The asynchronous update iterator returns that notification unchanged, even though `used` is not numeric.

The public `UsageUpdate` contract requires numeric `used` and `size` fields in `packages/poe-acp-client/src/types.ts:264`. `AcpClient` registers the native session notification callback directly in `packages/poe-acp-client/src/acp-client.ts:358`, and `handleSessionUpdateNotification()` immediately pushes the supplied notification into the active prompt queue in `packages/poe-acp-client/src/acp-client.ts:784` without validating either the update discriminator or its required fields.

## Expected Behavior

Native ACP notifications received from an agent should be validated before entering a typed prompt update stream. A `usage_update` containing a non-numeric token count should be rejected or excluded rather than delivered to consumers as `SessionUpdateNotification`.

## Impact

Consumers may aggregate usage, render token progress, enforce budgets, or generate reports from prompt update streams under the documented numeric contract. A malformed or compromised ACP agent can inject arbitrary non-numeric usage values through a live prompt, leading to arithmetic errors, corrupted budget calculations, invalid telemetry, or downstream crashes in code that reasonably trusts the exported types.
