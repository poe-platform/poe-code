# Terminal pilot screen renders stray backslash after OSC string terminator

## Summary

`terminal-pilot` consumes Operating System Command (OSC) sequences only until the `ESC` byte of the standard two-byte String Terminator (`ESC \\`). It returns to normal parsing before consuming the following backslash, so ordinary OSC title or hyperlink metadata terminated with `ST` injects a visible `\\` character into `screen()` output.

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
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() {} }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() {} }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("OSC string terminator", () => {
  it("renders the ST backslash after an OSC title update", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 30, rows: 2 });
    ptyEvents.emit("data", "before\u001b]0;private title\u001b\\after");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("before\\after");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["before\\after",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > OSC string terminator > renders the ST backslash after an OSC title update
```

## Observed Behavior

An OSC title update terminated with the standard `ESC \\` control pair does not display its title payload, but it adds a visible backslash between surrounding text. In `packages/terminal-pilot/src/terminal-buffer.ts`, the `State.Osc` branch returns to `State.Normal` immediately upon seeing byte `0x1b`, with a comment saying the following `\\` will be consumed; because the next byte is processed in normal state, it is instead written into the display as a regular character. The same premature transition exists for other string-sequence parsing in `State.Str`.

## Expected Behavior

The emulator should consume both bytes of an `ESC \\` String Terminator and resume display parsing only after the complete terminator has been removed. OSC metadata must not alter visible terminal cells unless the application separately emits display characters.

## Impact

Modern terminal applications routinely use OSC sequences for window titles, working directories, shell integration, and hyperlinks. Their normal output becomes corrupted in terminal-pilot snapshots, introducing stray punctuation into prompts, menu labels, copied text, and visual assertions, which can cause automation to misread or mismatch otherwise valid screens.
