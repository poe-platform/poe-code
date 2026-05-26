# Terminal pilot screen ignores insert mode

## Summary

`terminal-pilot` does not implement ANSI insert/replace mode (`CSI 4 h` / `CSI 4 l`). When a terminal application enables insert mode and writes into existing text, `screen()` overwrites cells instead of shifting the remainder of the row to the right.

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

describe("insert replace mode", () => {
  it("ignores insert mode and overwrites existing cells", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 10, rows: 2 });
    ptyEvents.emit("data", "abcd\r\u001b[4hX");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("Xbcd");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["Xbcd",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > insert replace mode > ignores insert mode and overwrites existing cells
```

## Observed Behavior

After rendering `abcd`, returning to column zero, enabling insert mode, and writing `X`, the visible line becomes `Xbcd`. `packages/terminal-pilot/src/terminal-buffer.ts:195` through `packages/terminal-pilot/src/terminal-buffer.ts:353` handle multiple CSI editing commands but do not process mode-setting `CSI 4 h` or `CSI 4 l`, while printable-character handling at `packages/terminal-pilot/src/terminal-buffer.ts:433` through `packages/terminal-pilot/src/terminal-buffer.ts:447` always replaces the current cell.

## Expected Behavior

When insert mode is enabled, writing `X` at the start of `abcd` should insert a new cell and shift existing display contents, rendering `Xabcd` within available width. Disabling insert mode should restore ordinary overwrite behavior.

## Impact

Line editors, forms, shell widgets, and full-screen terminal applications can use insert mode while updating user-visible fields. Terminal-pilot then presents a materially different string from the live terminal, causing agents to read truncated or overwritten values and interact with a display layout that the user did not see.
