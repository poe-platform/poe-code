# Terminal pilot screen cursor restore drops saved rendition

## Summary

`terminal-pilot` implements DEC cursor save/restore (`ESC 7` / `ESC 8`) by remembering only row and column coordinates. DEC saved-cursor state also includes graphic rendition, so restoring a cursor that was saved while a foreground color was active should restore that styling for subsequent output; instead, restored text is emitted unstyled in `screen().rawLines` and screenshots.

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

describe("DECSC graphic rendition", () => {
  it("does not restore foreground styling saved with ESC 7", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 10, rows: 2 });
    ptyEvents.emit("data", "A\u001b[31m\u001b7\u001b[0m\u001b[1;5HX\u001b8Y");
    const screen = await session.screen();
    console.log(JSON.stringify({ lines: screen.lines, raw: screen.rawLines }));
    expect(screen.lines[0]).toBe("AY  X");
    expect(screen.rawLines[0]).toBe("AY  X");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["AY  X",""],"raw":["AY  X",""]}
✓ packages/terminal-pilot/src/__probe__.test.ts > DECSC graphic rendition > does not restore foreground styling saved with ESC 7
```

## Observed Behavior

The cursor is saved after selecting red foreground, rendition is reset, `X` is written elsewhere, and the saved cursor is restored before writing `Y`. The plain output has the expected positioned characters, but `rawLines` contains no red SGR around `Y`. `packages/terminal-pilot/src/terminal-buffer.ts:471` through `packages/terminal-pilot/src/terminal-buffer.ts:477` store and restore only `_cursorX` and `_cursorY`; current `_style` and `_styleSequence` are not captured alongside the saved cursor.

## Expected Behavior

DEC save/restore cursor should preserve the cursor's saved graphic rendition state. After restoring the cursor in this stream, `Y` should carry the red foreground styling that was active at `ESC 7`, and raw screen output should retain that styling for screenshot rendering.

## Impact

Terminal programs commonly save cursor state while drawing styled status regions, restore it after updating another area, and continue rendering with the saved colors or attributes. Terminal-pilot can silently strip those restored highlights and alerts from styled screen output and screenshots, producing captures that differ from the live application display.
