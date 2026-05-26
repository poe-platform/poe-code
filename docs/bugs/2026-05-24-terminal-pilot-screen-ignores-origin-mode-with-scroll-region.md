# Terminal pilot screen ignores origin mode with scroll region

## Summary

`terminal-pilot` supports setting a scrolling region but ignores DEC origin mode (`CSI ? 6 h` / `CSI ? 6 l`). When origin mode is enabled, cursor-position sequences must be relative to the top of the configured scroll region; instead, `screen()` continues positioning relative to the full display.

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

describe("origin mode", () => {
  it("ignores DECOM and positions relative to the full screen", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 10, rows: 4 });
    ptyEvents.emit("data", "top\r\nmid\r\nlow\r\nbot");
    ptyEvents.emit("data", "\u001b[2;3r\u001b[?6h\u001b[1;1HX");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("Xop");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["Xop","mid","low","bot"]
✓ packages/terminal-pilot/src/__probe__.test.ts > origin mode > ignores DECOM and positions relative to the full screen
```

## Observed Behavior

With rows two through three configured as the scrolling region, enabling origin mode and issuing cursor position `1;1` should address the first row inside that region. Instead, `X` replaces the first character of the absolute top row (`Xop`). `packages/terminal-pilot/src/terminal-buffer.ts:330` through `packages/terminal-pilot/src/terminal-buffer.ts:339` store scroll margins, but the private-mode handling at `packages/terminal-pilot/src/terminal-buffer.ts:200` through `packages/terminal-pilot/src/terminal-buffer.ts:219` handles only auto-wrap and alternate-screen modes and does not track mode `6`; cursor positioning at `packages/terminal-pilot/src/terminal-buffer.ts:248` through `packages/terminal-pilot/src/terminal-buffer.ts:251` therefore remains absolute.

## Expected Behavior

When DEC origin mode is active, `CSI 1;1 H` after setting a `2;3` scroll region should place the cursor at row two, column one and change `mid` to `Xid`, preserving the fixed `top` row. Disabling origin mode should return cursor positioning to full-screen coordinates.

## Impact

Terminal interfaces use scrolling margins and origin mode to update bounded viewports while retaining headers, footers, and surrounding controls. Terminal-pilot can write content into protected fixed rows instead of the intended pane, making captured screens and subsequent automated interactions target the wrong UI elements.
