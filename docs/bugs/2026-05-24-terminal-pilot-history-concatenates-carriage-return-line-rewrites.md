# Terminal pilot history concatenates carriage return line rewrites

## Summary

`TerminalSession.history()` removes carriage-return control characters from raw PTY output without applying their terminal cursor semantics. When a program redraws a progress line with `\r`, history reports the old and new values concatenated together rather than the visible final line.

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
    write() {}, resize() {}, kill() {},
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() { ptyEvents.off("data", listener); } }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() { ptyEvents.off("exit", listener); } }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("terminal history line rewrites", () => {
  it("concatenates carriage-return progress updates instead of returning visible text", async () => {
    const session = new TerminalSession({ id: "session", command: "noop" });
    ptyEvents.emit("data", "loading 0%\rloading 100%\n");
    const history = await session.history();
    console.log(JSON.stringify({ history }));
    expect(history).toEqual(["loading 0%loading 100%"]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"history":["loading 0%loading 100%"]}
✓ packages/terminal-pilot/src/__probe__.test.ts > terminal history line rewrites > concatenates carriage-return progress updates instead of returning visible text
```

## Observed Behavior

`TerminalSession.history()` strips ANSI and passes its accumulated output to `normalizeHistoryBuffer()` in `packages/terminal-pilot/src/terminal-session.ts:189` through `packages/terminal-pilot/src/terminal-session.ts:198`. That normalizer at `packages/terminal-pilot/src/terminal-session.ts:365` through `packages/terminal-pilot/src/terminal-session.ts:377` simply discards `\r` and `\b` characters. As a result, a terminal update that visibly replaces `loading 0%` with `loading 100%` is returned as the synthetic text `loading 0%loading 100%`.

## Expected Behavior

History intended for agents and command consumers should preserve meaningful visible terminal lines by applying carriage-return/backspace rewriting semantics, or should explicitly expose raw transcript bytes separately. A line redrawn to `loading 100%` should not be presented as concatenated text that never appeared on screen.

## Impact

Commands and agents reading terminal history can misinterpret progress, prompts, status output, and interactive display updates from many standard CLIs. Concatenated stale and current content causes incorrect matching and reasoning, particularly for tools that redraw a line frequently while performing long-running actions.
