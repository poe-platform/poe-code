# Terminal pilot waitForExit infinite timeout expires immediately

## Summary

The public `terminal-pilot` `TerminalSession.waitForExit()` SDK method, also used by the `wait-for-exit` CLI/MCP command, accepts `timeout: Infinity` without validation. It forwards that value to `setTimeout()`, where Node coerces the infinite delay to one millisecond, so a caller requesting an effectively unbounded exit wait receives an immediate timeout error instead.

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

describe("TerminalSession infinite exit timeout", () => {
  it("rejects almost immediately instead of honoring an infinite timeout", async () => {
    const session = new TerminalSession({ id: "probe", command: "noop" });
    const startedAt = Date.now();
    const message = await session.waitForExit({ timeout: Number.POSITIVE_INFINITY }).then(
      () => "resolved",
      (error: Error) => error.message
    );
    const elapsedMs = Date.now() - startedAt;
    console.log(JSON.stringify({ message, elapsedMs }));
    expect(message).toBe("Timed out waiting for process to exit after Infinityms");
    expect(elapsedMs).toBeLessThan(50);
  });
});
```

Run the focused probe, then remove the disposable file:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

## Observed Behavior

The probe passes after Node warns about the invalid timer duration and the API rejects after approximately one millisecond:

```text
(node:...) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
{"message":"Timed out waiting for process to exit after Infinityms","elapsedMs":1}
✓ packages/terminal-pilot/src/__probe__.test.ts > TerminalSession infinite exit timeout > rejects almost immediately instead of honoring an infinite timeout
```

`TerminalSession.waitForExit()` forwards the optional caller timeout to its private timer race at `packages/terminal-pilot/src/terminal-session.ts:211` through `packages/terminal-pilot/src/terminal-session.ts:225`. The helper passes that value directly to `setTimeout()` at `packages/terminal-pilot/src/terminal-session.ts:385` through `packages/terminal-pilot/src/terminal-session.ts:407`. Because `Infinity` is not validated, Node reduces the timer to one millisecond and the public method reports an immediate timeout while the process remains alive. The exported `wait-for-exit` command forwards its numeric timeout into this method in `packages/terminal-pilot/src/commands/wait-for-exit.ts`.

## Expected Behavior

Exit waits should reject non-finite timeout arguments before timer scheduling, or deliberately support an infinite wait by omitting the timer race. Passing `Infinity` must not silently invert an intended unbounded wait into an immediate timeout failure.

## Impact

Automation invoking terminal sessions through the SDK, CLI command layer, or MCP server can abandon still-running processes immediately when a configured timeout evaluates to infinity. This can trigger premature retries, incorrect failure reporting, leaked sessions, or subsequent commands issued under the false assumption that the process failed to exit within a meaningful deadline.
