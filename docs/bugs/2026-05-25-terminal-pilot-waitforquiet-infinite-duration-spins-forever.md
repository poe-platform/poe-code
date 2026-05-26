# Terminal pilot waitForQuiet infinite duration spins forever

## Summary

The exported `terminal-pilot` `TerminalSession.waitForQuiet(ms)` SDK method accepts a non-finite duration such as `Infinity` without validation. Instead of rejecting an invalid quiet-period request, it repeatedly schedules overflow-coerced timers and never resolves, producing an unbounded wait loop and repeated runtime warnings.

## Reproduction

Add this disposable Vitest probe as `packages/terminal-pilot/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const ptyEvents = new EventEmitter();
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 42,
    write() {},
    resize() {},
    kill() {},
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() {} }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() {} }; }
  })
}));

const { TerminalSession } = await import("./terminal-session.js");

describe("TerminalSession non-finite quiet duration", () => {
  it("does not resolve waitForQuiet with Infinity", async () => {
    const session = new TerminalSession({ id: "probe", command: "noop" });
    const state = await Promise.race([
      session.waitForQuiet(Number.POSITIVE_INFINITY).then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 30))
    ]);
    console.log(JSON.stringify({ state }));
    expect(state).toBe("pending");
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

## Observed Behavior

The probe passes after observing that the SDK call is still pending, while Node emits repeated timer overflow warnings because each loop iteration schedules an infinite delay that is coerced to one millisecond:

```text
(node:...) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
{"state":"pending"}
✓ packages/terminal-pilot/src/__probe__.test.ts > TerminalSession non-finite quiet duration > does not resolve waitForQuiet with Infinity
```

`waitForQuiet(ms)` is exposed on the exported `TerminalSession` class and calculates `remaining = ms - (Date.now() - this.lastDataAt)` at `packages/terminal-pilot/src/terminal-session.ts:158` through `packages/terminal-pilot/src/terminal-session.ts:166`. With `ms === Infinity`, `remaining` is always infinite, so the method calls the local timer helper repeatedly. The timer helper forwards that infinite delay into `setTimeout()` at `packages/terminal-pilot/src/terminal-session.ts:380` through `packages/terminal-pilot/src/terminal-session.ts:383`, and Node reduces it to a one-millisecond timer with a warning, returning control only for the next infinite iteration.

## Expected Behavior

`waitForQuiet()` should accept only finite, non-negative durations appropriate for timer scheduling and reject `Infinity`, `NaN`, or otherwise invalid inputs before entering its wait loop. A malformed quiet-period request must not create an indefinite busy timer cycle.

## Impact

SDK consumers that propagate a calculated or user-provided infinite quiet duration can hang task execution while rapidly generating timer warnings and event-loop work. This can stall terminal automation, leak pending workflows, and consume runtime resources until the process is externally interrupted.
