# Process launcher NaN TCP readiness timeout leaks open socket on error

## Summary

The exported `@poe-code/process-launcher` `waitForReady()` API accepts a TCP readiness check whose `timeoutMs` is `Number.NaN`. It opens a socket before attempting to configure the derived socket timeout; when the invalid timeout throws, the returned promise rejects without destroying the socket that has already been created.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/health/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const { connectMock, socket } = vi.hoisted(() => {
  const createdSocket = {
    setTimeout: vi.fn(() => {
      throw new RangeError("invalid timeout");
    }),
    once: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn()
  };
  return {
    socket: createdSocket,
    connectMock: vi.fn(() => createdSocket)
  };
});

vi.mock("node:net", () => ({
  default: { connect: connectMock }
}));

import { waitForReady } from "./health-check.js";

describe("process-launcher NaN TCP readiness timeout", () => {
  it("connects before rejecting while leaving the socket undisposed", async () => {
    await expect(
      waitForReady({ kind: "tcp", host: "127.0.0.1", port: 42, timeoutMs: Number.NaN }, {})
    ).rejects.toThrow("invalid timeout");

    expect(connectMock).toHaveBeenCalledOnce();
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/health/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/health/__probe__.test.ts
```

## Observed Behavior

The public readiness call rejects only after one connection has already been initiated, and the rejection path never invokes socket cleanup:

```text
✓ packages/process-launcher/src/health/__probe__.test.ts > process-launcher NaN TCP readiness timeout > connects before rejecting while leaving the socket undisposed
```

The probe observes:

```json
{"connectCalls":1,"destroyCalls":0,"error":"invalid timeout"}
```

`waitForReady()` dispatches TCP checks to `waitForTcp()` in `packages/process-launcher/src/health/health-check.ts`. That function computes `deadline = Date.now() + timeoutMs`, which becomes `NaN`, then enters `attemptConnection()` because `Date.now() >= NaN` is false. It creates the socket with `net.connect()` before computing `socketTimeoutMs` from the invalid deadline and calling `socket.setTimeout(socketTimeoutMs)`. If that timeout configuration rejects or throws, no `finish()` or `failAttempt()` path has run, so `activeSocket` is never destroyed.

## Expected Behavior

TCP readiness configuration should validate that `timeoutMs`, when supplied, is a finite non-negative duration before creating any socket. If setup fails after opening a socket, the failure path must dispose of that socket before rejecting.

## Impact

Invalid readiness configuration can create outbound TCP connection attempts even though the readiness operation immediately fails. In long-lived processes or repeated retries, this can leak sockets or pending connection activity, create unintended network traffic, and leave callers with an input-validation error only after external side effects have already begun.
