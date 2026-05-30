---
name: "Terminal pilot thrown kill poisons subsequent close retries"
---

# Terminal pilot thrown kill poisons subsequent close retries

## Summary

`TerminalSession.close()` marks the close operation as requested before attempting its first termination signal. If the PTY backend throws while receiving `SIGTERM`, the call rejects, but all later `close()` calls skip termination escalation and wait forever on an exit promise that the failed kill never triggered.

## Reproduction

Create the disposable probe `packages/terminal-pilot/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { pty } = vi.hoisted(() => ({
  pty: {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn().mockImplementationOnce(() => {
      throw new Error("kill temporarily failed");
    }),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
}));

vi.mock("node-pty", () => ({ spawn: vi.fn(() => pty) }));

import { TerminalSession } from "./terminal-session.js";

describe("TerminalSession failed kill retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never retries escalation after the first termination request throws", async () => {
    vi.useFakeTimers();
    const session = new TerminalSession({ id: "session", command: "noop" });
    const firstClose = session.close();
    const failedClose = expect(firstClose).rejects.toThrow("kill temporarily failed");

    await vi.advanceTimersByTimeAsync(250);
    await failedClose;

    const secondClose = session.close();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pty.kill).toHaveBeenCalledTimes(1);
    await expect(Promise.race([secondClose.then(() => "settled"), Promise.resolve("pending")])).resolves.toBe("pending");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/terminal-pilot/src/__probe__.test.ts > TerminalSession failed kill retry > never retries escalation after the first termination request throws
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

On the first call, `close()` sets `this.closeRequested = true` before attempting termination at `packages/terminal-pilot/src/terminal-session.ts:232` through `packages/terminal-pilot/src/terminal-session.ts:245`. When `this.pty.kill("SIGTERM")` throws, that call rejects without an exit event. On the next call, the `!this.closeRequested` branch is skipped and `close()` returns `this.exitPromise` at `packages/terminal-pilot/src/terminal-session.ts:257`; even after advancing well beyond every built-in grace interval, the PTY kill spy remains called only once and the retry is still pending.

## Expected Behavior

A failed termination request should leave shutdown retryable or reset the close-escalation state before surfacing the error. Calling `close()` again after a transient PTY kill failure should retry termination rather than permanently waiting for an exit event that was never initiated.

## Impact

A transient exception from the PTY backend during shutdown can permanently strand a running terminal process. Cleanup callers receive an initial error but cannot recover by retrying through the public session API, leading to leaked child processes and hung higher-level `TerminalPilot.close()` or server shutdown operations.
