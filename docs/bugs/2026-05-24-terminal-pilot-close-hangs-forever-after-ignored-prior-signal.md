# Terminal pilot close hangs forever after ignored prior signal

## Summary

`TerminalSession.close()` has a graceful termination path that escalates to `SIGTERM` and `SIGKILL`, but it disables that escalation whenever any earlier `signal()` call was made. If a process ignores a prior signal such as `SIGINT`, a subsequent `close()` waits indefinitely for an exit that may never occur.

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
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() { ptyEvents.off("data", listener); } }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() { ptyEvents.off("exit", listener); } }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("close after ignored signal", () => {
  it("waits forever instead of escalating after a prior signal is ignored", async () => {
    vi.useFakeTimers();
    const session = new TerminalSession({ id: "demo", command: "noop" });
    await session.signal("SIGINT");
    const pending = session.close();
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    console.log(JSON.stringify({ kills, settled, exitCode: session.exitCode }));
    expect(kills).toEqual(["SIGINT"]);
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
{"kills":["SIGINT"],"settled":false,"exitCode":null}
✓ packages/terminal-pilot/src/__probe__.test.ts > close after ignored signal > waits forever instead of escalating after a prior signal is ignored
```

## Observed Behavior

`signal()` marks `signalRequested = true` and forwards the requested signal in `packages/terminal-pilot/src/terminal-session.ts:133` through `packages/terminal-pilot/src/terminal-session.ts:140`. `close()` initially waits a short grace period, but at `packages/terminal-pilot/src/terminal-session.ts:231` through `packages/terminal-pilot/src/terminal-session.ts:233` it returns the unresolved `exitPromise` immediately whenever `signalRequested` is true, skipping its later `SIGTERM` and `SIGKILL` escalation. In the reproduction the PTY ignores `SIGINT`, no exit occurs, and `close()` remains unsettled even after ten seconds.

## Expected Behavior

`close()` should remain a bounded cleanup operation regardless of prior user-directed signals. After allowing an already-sent signal an appropriate grace period, it should still escalate termination when the process remains alive, or expose an explicit timeout failure instead of returning an unbounded pending promise.

## Impact

Interactive automation commonly sends `SIGINT` before cleaning up a session. When a process handles or ignores that interrupt without exiting, terminal-pilot shutdown, runtime cleanup, MCP teardown, and test teardown can hang permanently, leaving live PTY children and blocked callers.
