# Terminal pilot waitFor infinite timeout never expires

## Summary

The public `terminal-pilot` `TerminalSession.waitFor()` SDK method, also used by the `wait-for` CLI/MCP command, accepts `timeout: Infinity` without validation. For an unmatched pattern on a live session, the elapsed-time condition can never exceed an infinite timeout, so the call polls forever instead of rejecting a malformed timeout request.

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

describe("TerminalSession non-finite pattern timeout", () => {
  it("keeps polling forever with an infinite waitFor timeout", async () => {
    const session = new TerminalSession({ id: "probe", command: "noop" });
    const state = await Promise.race([
      session.waitFor("never emitted", { timeout: Number.POSITIVE_INFINITY }).then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 35))
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

The probe passes after the public wait remains pending rather than returning a timeout error:

```text
{"state":"pending"}
✓ packages/terminal-pilot/src/__probe__.test.ts > TerminalSession non-finite pattern timeout > keeps polling forever with an infinite waitFor timeout
```

`TerminalSession.waitFor()` obtains its numeric timeout and loops while `Date.now() - startedAt <= timeout` at `packages/terminal-pilot/src/terminal-session.ts:142` through `packages/terminal-pilot/src/terminal-session.ts:155`. When `timeout` is `Infinity`, that condition remains true indefinitely and the method continues polling every ten milliseconds. The exported `wait-for` command forwards its optional numeric `timeout` directly into this method in `packages/terminal-pilot/src/commands/wait-for.ts` without adding finite-value validation.

## Expected Behavior

Pattern waits should accept only finite, non-negative timeout durations and reject `Infinity`, `NaN`, or otherwise invalid command/SDK input before polling begins. A caller asking for an invalid timeout must receive an actionable validation error rather than an unbounded wait.

## Impact

Terminal automation driven through the SDK, CLI command framework, or MCP wrapper can become permanently stuck when an infinite timeout reaches `wait-for`. A malformed value from config, arithmetic, or tool input causes the run to occupy a live polling loop until externally cancelled, blocking higher-level workflows and cleanup.
