---
name: "Terminal pilot screen cursor restore drops saved auto-wrap mode"
---

# Terminal pilot screen cursor restore drops saved auto-wrap mode

## Summary

`terminal-pilot` does not save and restore DEC auto-wrap mode as part of `ESC 7` / `ESC 8` cursor state. A terminal application that saves its cursor with auto-wrap disabled, temporarily enables wrapping, and then restores its saved state still receives wrapping behavior in the captured screen rather than the restored no-wrap behavior.

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

describe("DECSC autowrap mode", () => {
  it("does not restore disabled autowrap after ESC 8", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 3, rows: 2 });
    ptyEvents.emit("data", "\u001b[?7l\u001b7\u001b[?7h\u001b8abcd");
    const screen = await session.screen();
    console.log(JSON.stringify({ lines: screen.lines, cursor: screen.cursor }));
    expect(screen.lines).toEqual(["abc", "d"]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["abc","d"],"cursor":{"row":1,"col":1}}
✓ packages/terminal-pilot/src/__probe__.test.ts > DECSC autowrap mode > does not restore disabled autowrap after ESC 8
```

## Observed Behavior

The stream disables auto-wrap, saves cursor state, enables auto-wrap, restores the cursor, and writes past a three-column margin. Text wraps onto the next row, showing that the auto-wrap mode active after the save remains in effect after restore. `packages/terminal-pilot/src/terminal-buffer.ts:200` through `packages/terminal-pilot/src/terminal-buffer.ts:204` track `_autoWrap`, but `packages/terminal-pilot/src/terminal-buffer.ts:471` through `packages/terminal-pilot/src/terminal-buffer.ts:477` store and restore coordinates only.

## Expected Behavior

DEC cursor save/restore should retain applicable mode state including auto-wrap. Because auto-wrap was disabled when the cursor was saved, restoring it should restore no-wrap behavior; writing `abcd` in three columns should overwrite the rightmost cell as `abd` rather than wrap `d` to the next row.

## Impact

Terminal applications can save cursor and mode state while composing constrained status areas, temporarily change wrapping while drawing another region, then restore. Terminal-pilot may carry the temporary mode into restored output, changing line layout and shifting subsequent screen content from what the live terminal shows.
