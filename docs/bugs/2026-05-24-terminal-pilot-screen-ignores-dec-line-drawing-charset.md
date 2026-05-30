---
name: "Terminal pilot screen ignores DEC line-drawing charset"
---

# Terminal pilot screen ignores DEC line-drawing charset

## Summary

`terminal-pilot` consumes DEC character-set designation sequences such as `ESC ( 0` but does not apply the selected special-graphics mapping to subsequent display characters. Applications that draw terminal borders and widgets with DEC line-drawing output are captured as ordinary ASCII letters instead of the displayed box glyphs.

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

describe("DEC special graphics charset", () => {
  it("renders ASCII q instead of the selected line drawing glyph", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 10, rows: 2 });
    ptyEvents.emit("data", "\u001b(0q\u001b(B");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("q");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["q",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > DEC special graphics charset > renders ASCII q instead of the selected line drawing glyph
```

## Observed Behavior

With DEC special graphics selected for the G0 set, the input character `q` should display as a horizontal line glyph, but `screen()` returns literal `q`. `packages/terminal-pilot/src/terminal-buffer.ts:465` through `packages/terminal-pilot/src/terminal-buffer.ts:467` transition into `State.EscCharset` for charset designation, and `packages/terminal-pilot/src/terminal-buffer.ts:386` through `packages/terminal-pilot/src/terminal-buffer.ts:388` simply consume the designation byte and return to normal state without recording a charset. Printable text is then written unchanged at `packages/terminal-pilot/src/terminal-buffer.ts:433` through `packages/terminal-pilot/src/terminal-buffer.ts:447`.

## Expected Behavior

The emulator should track DEC G0/G1 character-set designations and translate special-graphics input while the selected set is active. This sequence should render a horizontal box-drawing line (`─`) and switch back to ASCII after `ESC ( B`.

## Impact

Menu systems, terminal forms, installers, monitoring dashboards, and other TUIs frequently draw borders, separators, and connector lines with DEC special graphics for broad terminal compatibility. Terminal-pilot screen reads and screenshots can replace those visual structures with misleading letters, making layouts difficult to interpret and interactive targeting unreliable.
