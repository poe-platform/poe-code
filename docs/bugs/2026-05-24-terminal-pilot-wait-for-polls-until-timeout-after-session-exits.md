# Terminal pilot wait for polls until timeout after session exits

## Summary

`TerminalSession.waitFor()` continues polling for its entire configured timeout after the terminal process has already exited without matching output. Because the data listener is disposed on process exit, no future output can satisfy the pending wait, yet callers receive no early terminal-state failure.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const ptyEvents = new EventEmitter();
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 42,
    write() {},
    resize() {},
    kill() {},
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() { ptyEvents.off("data", listener); } }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() { ptyEvents.off("exit", listener); } }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("waitFor after process exit", () => {
  it("waits the full timeout even after the process exits without matching output", async () => {
    vi.useFakeTimers();
    const session = new TerminalSession({ id: "demo", command: "noop" });
    const pending = session.waitFor("never", { timeout: 1000 }).catch((error: Error) => error.message);
    ptyEvents.emit("exit", { exitCode: 0 });
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    console.log(JSON.stringify({ exitCode: session.exitCode, result }));
    expect(result).toContain("Timed out waiting for pattern after 1000ms");
    vi.useRealTimers();
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"exitCode":0,"result":"Timed out waiting for pattern after 1000ms: never"}
✓ packages/terminal-pilot/src/__probe__.test.ts > waitFor after process exit > waits the full timeout even after the process exits without matching output
```

## Observed Behavior

`TerminalSession` sets `exitCode`, disposes its PTY data subscription, and resolves its exit promise when the process exits in `packages/terminal-pilot/src/terminal-session.ts:94` through `packages/terminal-pilot/src/terminal-session.ts:106`. However, `waitFor()` at `packages/terminal-pilot/src/terminal-session.ts:142` through `packages/terminal-pilot/src/terminal-session.ts:155` only polls the already-captured raw buffer and elapsed timeout; it never checks `exitCode` or races process completion. Once an unmatched session has exited, it still sleeps until timeout even though its raw buffer can no longer change.

## Expected Behavior

`waitFor()` should inspect existing buffered output and then reject promptly once the underlying process has exited without a match, ideally reporting that the terminal session finished before the requested pattern appeared. It should not consume the caller's full timeout when success has become impossible.

## Impact

Automation using terminal-pilot to wait for prompts or completion markers is unnecessarily delayed by the full timeout whenever a command exits early or fails before printing expected text. With default waits this adds ten-second stalls per failure and can cascade into slow MCP workflows, retries, and CI timeouts.
