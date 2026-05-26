# Terminal pilot close hangs after SIGKILL when PTY never reports exit

## Summary

`TerminalSession.close()` escalates an unresponsive session through `SIGTERM` and `SIGKILL`, but after sending `SIGKILL` it still returns the raw exit promise with no final timeout or failure path. If the PTY backend never emits its exit event after a successful kill request, cleanup remains pending forever.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const ptyEvents = new EventEmitter();
const kills: string[] = [];
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 42,
    write() {},
    resize() {},
    kill(signal?: string) { kills.push(signal ?? "default"); },
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() {} }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() {} }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("close with unresponsive PTY", () => {
  it("hangs after SIGKILL if the PTY never emits exit", async () => {
    vi.useFakeTimers();
    const session = new TerminalSession({ id: "session", command: "noop" });
    const pending = session.close();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2000);
    console.log(JSON.stringify({ kills, settled }));
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"kills":["SIGTERM","SIGKILL"],"settled":false}
✓ packages/terminal-pilot/src/__probe__.test.ts > close with unresponsive PTY > hangs after SIGKILL if the PTY never emits exit
```

## Observed Behavior

`close()` waits for its initial graceful period, sends `SIGTERM`, waits again, and sends `SIGKILL` at `packages/terminal-pilot/src/terminal-session.ts:235` through `packages/terminal-pilot/src/terminal-session.ts:254`. It then returns `this.exitPromise` at `packages/terminal-pilot/src/terminal-session.ts:257` without bounding that final wait. The reproduced PTY accepts both termination calls but never emits `exit`, so `close()` stays unsettled after escalation is exhausted.

## Expected Behavior

After the strongest termination action has been issued, `close()` should resolve or reject within a bounded time even if the PTY implementation fails to deliver an exit event. A lost exit notification must not convert cleanup into an indefinitely pending operation.

## Impact

PTY implementations, process wrappers, or mocked sessions that fail to surface an exit notification after termination can permanently hang terminal-pilot shutdown, runtime cleanup, MCP handlers, and test teardown even though the caller already requested forced termination. This is distinct from a prior user signal suppressing escalation because it occurs after the normal `SIGTERM` and `SIGKILL` path has completed.
