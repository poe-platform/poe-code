# Poe ACP client exposed agent capability mutation bypasses prompt content guard

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient.agentCapabilities` getter returns the mutable capability object received during initialization. The client later reuses that same object to validate prompt content, so a caller can mutate an agent that advertised `image: false` into appearing to support images and send an unsupported `session/prompt` request.

## Reproduction

Create a disposable probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AcpTransport } from "./acp-transport.js";
import { AcpClient } from "./acp-client.js";
import type { InitializeResponse, PromptResponse } from "./types.js";

describe("AcpClient exported agent capabilities mutation", () => {
  it("permits a later unsupported image prompt after getter mutation", async () => {
    const sendRequest = vi
      .fn<(method: string, params?: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({
        protocolVersion: 1,
        agentCapabilities: { promptCapabilities: { image: false } }
      } satisfies InitializeResponse)
      .mockResolvedValueOnce({ stopReason: "completed" } satisfies PromptResponse);
    const client = new AcpClient({
      protocolVersion: 1,
      transport: {
        sendRequest: sendRequest as unknown as AcpTransport["sendRequest"],
        sendNotification: vi.fn() as unknown as AcpTransport["sendNotification"],
        onRequest: vi.fn() as unknown as AcpTransport["onRequest"],
        onNotification: vi.fn() as unknown as AcpTransport["onNotification"]
      }
    });

    await client.initialize();

    expect(() =>
      client.prompt("safe", [{ type: "image", data: "AA==", mimeType: "image/png" }])
    ).toThrow('Agent does not support prompt content type "image".');

    client.agentCapabilities!.promptCapabilities!.image = true;
    const turn = client.prompt("bypassed", [
      { type: "image", data: "AA==", mimeType: "image/png" }
    ]);

    await expect(turn.response).resolves.toEqual({ stopReason: "completed" });
    expect(sendRequest).toHaveBeenLastCalledWith("session/prompt", {
      sessionId: "bypassed",
      prompt: [{ type: "image", data: "AA==", mimeType: "image/png" }]
    });
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > AcpClient exported agent capabilities mutation > permits a later unsupported image prompt after getter mutation
```

## Observed Behavior

`initialize()` stores `response.agentCapabilities` by reference at `packages/poe-acp-client/src/acp-client.ts:387` through `packages/poe-acp-client/src/acp-client.ts:423`, and the public `agentCapabilities` getter returns that same reference at `packages/poe-acp-client/src/acp-client.ts:375` through `packages/poe-acp-client/src/acp-client.ts:377`. `prompt()` invokes its content compatibility guard before dispatching at `packages/poe-acp-client/src/acp-client.ts:509` through `packages/poe-acp-client/src/acp-client.ts:527`, but that guard reads the mutable stored capability object at `packages/poe-acp-client/src/acp-client.ts:828` through `packages/poe-acp-client/src/acp-client.ts:844`. After a caller sets `client.agentCapabilities.promptCapabilities.image = true`, an image content block defined by `packages/poe-acp-client/src/types.ts:21` through `packages/poe-acp-client/src/types.ts:27` is transmitted even though the peer originally negotiated `image: false`.

## Expected Behavior

Negotiated agent capability state should not be mutable through public metadata access. Reading `client.agentCapabilities` must either return an immutable snapshot or a defensive copy, and later request validation must continue enforcing the capabilities advertised during initialization.

## Impact

Any same-process consumer that inspects the public client metadata can silently bypass ACP compatibility checks for images, audio, embedded resources, MCP transport types, or session loading by mutating the returned nested capability object. Requests can then be sent that the negotiated agent explicitly did not support, producing protocol failures, lost content, or inconsistent client behavior that appears to be endorsed by the handshake.
