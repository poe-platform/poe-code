---
name: "Terminal pilot failed close drops a still-unclosed session from retryable state"
---

# Terminal pilot failed close drops a still-unclosed session from retryable state

## Summary

`TerminalPilot.close()` clears its entire tracked-session map in a `finally` block even when a tracked session's `close()` rejects. The failed session is no longer addressable through the pilot, and calling `pilot.close()` again cannot retry the shutdown that failed.

## Reproduction

Create the disposable probe `packages/terminal-pilot/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => {
  const close = vi.fn()
    .mockRejectedValueOnce(new Error("close temporarily failed"))
    .mockResolvedValueOnce(0);
  return { close };
});

vi.mock("./terminal-session.js", () => ({
  TerminalSession: class {
    readonly id = "session-1";
    exitCode = null;
    close = sessionMocks.close;
  }
}));

import { TerminalPilot } from "./terminal-pilot.js";

describe("TerminalPilot failed close retry", () => {
  it("forgets a session whose close rejected before shutdown can be retried", async () => {
    const pilot = await TerminalPilot.launch();
    const session = await pilot.newSession({ command: "ignored" });

    await expect(pilot.close()).rejects.toThrow("close temporarily failed");
    expect(() => pilot.getSession(session.id)).toThrow("Session not found");

    await expect(pilot.close()).resolves.toBeUndefined();
    expect(sessionMocks.close).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/terminal-pilot/src/__probe__.test.ts > TerminalPilot failed close retry > forgets a session whose close rejected before shutdown can be retried
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`TerminalPilot.close()` copies tracked sessions, awaits all `session.close()` calls, and unconditionally executes `this.sessionMap.clear()` from its `finally` block at `packages/terminal-pilot/src/terminal-pilot.ts:57` through `packages/terminal-pilot/src/terminal-pilot.ts:64`. In the probe, the first underlying `close()` rejects with `close temporarily failed`; despite that rejection, the session becomes unavailable through `getSession()`. A subsequent `pilot.close()` has no sessions left to close, resolves successfully, and never invokes the underlying shutdown a second time.

## Expected Behavior

A session whose shutdown failed should remain tracked so callers can inspect it and retry closing it, or `TerminalPilot.close()` should complete reliable cleanup itself before removing the session. A rejected shutdown must not be followed by an empty, successful retry while the failed session remains potentially alive.

## Impact

Transient terminal-session shutdown failures can leave PTY resources running while the owning `TerminalPilot` permanently forgets how to close them. Long-lived hosts or MCP servers can leak child processes and descriptors, and later cleanup attempts falsely report success because the failed session was removed from retryable state.
