---
name: "Terminal pilot screen treats DEL as destructive backspace"
---

# Terminal pilot screen treats DEL as destructive backspace

## Summary

`terminal-pilot` interprets the output control byte `DEL` (`0x7f`) as a destructive backspace: it moves the cursor left and overwrites the preceding visible cell with a space. Terminals conventionally ignore `DEL` in display output, so a process that emits it can silently remove already rendered characters from `screen()` snapshots.

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

describe("DEL input", () => {
  it("destructively erases visible text when DEL should be ignored", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 20, rows: 2 });
    ptyEvents.emit("data", "secret\u007f!");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("secre!");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["secre!",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > DEL input > destructively erases visible text when DEL should be ignored
```

## Observed Behavior

Writing `secret`, followed by `DEL`, followed by `!` returns `secre!`, because the final `t` was removed before `!` was placed. `packages/terminal-pilot/src/terminal-buffer.ts:416` through `packages/terminal-pilot/src/terminal-buffer.ts:421` explicitly handles `0x7f` by decrementing `_cursorX` and writing a space into that cell, even though `DEL` is not a terminal erase operation.

## Expected Behavior

`DEL` received in terminal output should be ignored as a non-printing control character, leaving the displayed text unchanged; this stream should render as `secret!`. Applications that want to move or erase visible cells can emit supported cursor/erase controls explicitly.

## Impact

Programs, protocol bridges, or imperfect subprocess output that contain `DEL` bytes can cause terminal-pilot screen reads and screenshots to omit text that was displayed before the byte arrived. Agents may misread prompts, identifiers, status values, or secrets because snapshot content is destructively rewritten by a byte that should not alter the display.
