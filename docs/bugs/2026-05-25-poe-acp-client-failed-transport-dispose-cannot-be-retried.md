# Poe ACP client failed transport dispose cannot be retried

## Summary

`AcpClient.dispose()` marks the client disposed before calling its injected transport's `dispose()` callback. If that callback throws transiently, the first client disposal rejects, but every later disposal attempt skips the transport callback and resolves without retrying cleanup.

## Reproduction

Create the disposable probe `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";

describe("ACP client failed transport disposal", () => {
  it("never retries a transport disposer that throws once", async () => {
    const dispose = vi.fn()
      .mockImplementationOnce(() => { throw new Error("dispose temporarily failed"); })
      .mockImplementationOnce(() => undefined);
    const client = new AcpClient({
      transport: {
        sendRequest: vi.fn(),
        sendNotification: vi.fn(),
        onRequest: vi.fn(),
        onNotification: vi.fn(),
        dispose,
      },
    });

    await expect(client.dispose()).rejects.toThrow("dispose temporarily failed");
    await expect(client.dispose()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > ACP client failed transport disposal > never retries a transport disposer that throws once
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`AcpClient.dispose()` returns early for already disposed clients at `packages/poe-acp-client/src/acp-client.ts:603` through `packages/poe-acp-client/src/acp-client.ts:609`, and sets `this.disposed = true` before invoking `this.transport.dispose(disposeReason)` at `packages/poe-acp-client/src/acp-client.ts:611` through `packages/poe-acp-client/src/acp-client.ts:620`. In the probe, the transport disposer throws `dispose temporarily failed` on its first invocation but would succeed on its second. The first `client.dispose()` rejects, the second resolves through the already-disposed branch, and the transport disposer remains called only once.

## Expected Behavior

If an injected transport's disposal operation throws, the client should retain enough ownership to retry that transport cleanup on a later `dispose()` call, or explicitly communicate that cleanup has entered an unrecoverable partial state. A rejected first disposal must not turn subsequent attempts into successful no-ops.

## Impact

Transient transport teardown errors can leave ACP subprocesses, pipes, or injected transport resources active after the client has permanently marked itself disposed. Applications cannot recover through the public cleanup API, and later successful-looking disposal attempts can mask leaked runtime resources.
