# Poe ACP client terminal create forwards negative output byte limit to handler

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient` registers incoming `terminal/create` requests and forwards their optional `outputByteLimit` field directly to the configured terminal handler. Unlike its validation of filesystem line parameters, it performs no runtime bounds validation for this terminal limit, so a protocol request containing `-1` reaches application code as an accepted output byte bound.

## Reproduction

Create the following disposable probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";

describe("AcpClient terminal output byte limit validation", () => {
  it("forwards a negative outputByteLimit to the configured terminal handler", async () => {
    const requests = new Map<string, (params: any) => Promise<any>>();
    const create = vi.fn(async () => "term-1");
    const transport = {
      sendRequest: vi.fn(),
      sendNotification: vi.fn(),
      onNotification: vi.fn(),
      onRequest: vi.fn((method: string, handler: (params: any) => Promise<any>) => {
        requests.set(method, handler);
      })
    };

    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
      terminalHandler: {
        create,
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {}
      }
    });

    await requests.get("terminal/create")?.({
      sessionId: "session-1",
      command: "npm",
      outputByteLimit: -1
    });

    expect(create).toHaveBeenCalledWith({
      sessionId: "session-1",
      command: "npm",
      args: undefined,
      cwd: undefined,
      env: undefined,
      outputByteLimit: -1
    });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > AcpClient terminal output byte limit validation > forwards a negative outputByteLimit to the configured terminal handler
```

## Observed Behavior

`packages/poe-acp-client/src/index.ts` publicly exports `AcpClient`. Its terminal handler interface accepts an optional numeric `outputByteLimit`, and `registerCapabilityHandlers()` invokes the configured `terminalHandler.create()` callback using `params.outputByteLimit` directly from the incoming `terminal/create` request. A valid JSON request with `outputByteLimit: -1` consequently reaches the handler unchanged instead of being rejected with ACP `invalid_params`.

## Expected Behavior

Incoming `terminal/create` byte limits should be validated at the protocol boundary before handler invocation. Negative `outputByteLimit` values should be rejected as invalid parameters rather than forwarded to terminal implementations.

## Impact

ACP agents can send impossible negative byte budgets into client-owned terminal implementations. Depending on the handler, a negative bound may disable truncation, trigger immediate truncation, corrupt buffer-accounting decisions, or cause downstream exceptions, while the client reports the request as a normal supported terminal operation.
